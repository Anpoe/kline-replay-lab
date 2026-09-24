import {
  applyLiveStatePatch,
  readLiveState,
} from "./live-ledger.ts";
import {
  cancelPendingOrderFromTradingCommand,
  createCloseOrderFromTradingCommand,
  createOpenOrderFromTradingCommand,
  modifyProtectionFromTradingCommand,
  normalizeTradingCommand,
  TradingCommandError,
  type TradingCommand,
} from "../app/lib/tradingCommands.ts";
import {
  liveAccountAvailableCash,
  liveAccountCurrencyForMarket,
} from "../app/lib/tradingAccount.ts";
import { EXECUTION_ENGINE_VERSION, estimatedBuyCashRequired } from "../app/lib/executionEngine.ts";

type LiveState = Awaited<ReturnType<typeof readLiveState>>;
type LiveAccount = LiveState["accounts"][number];
type LivePortfolio = LiveState["portfolios"][number];

export type LiveTradingCommandResult = {
  accepted: true;
  commandId: string;
  idempotent: boolean;
  accountVersion: number;
  account: LiveAccount;
  portfolios: LivePortfolio[];
};

function commandJson(command: TradingCommand) {
  return JSON.stringify(command);
}

async function readReceipt(db: D1Database, commandId: string) {
  const row = await db.prepare(`SELECT command_json AS commandJson, result_json AS resultJson
    FROM live_command_receipts WHERE command_id = ?`).bind(commandId).first<{
      commandJson: string;
      resultJson: string;
    }>();
  if (!row) return null;
  return row;
}

async function writeReceipt(
  db: D1Database,
  command: TradingCommand,
  serializedCommand: string,
  result: LiveTradingCommandResult,
) {
  await db.prepare(`INSERT INTO live_command_receipts
    (command_id, account_id, command_type, command_json, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(command_id) DO NOTHING`)
    .bind(command.commandId, command.accountId, command.type, serializedCommand, JSON.stringify(result), new Date().toISOString())
    .run();
}

function orderReservation(order: Record<string, unknown>) {
  return order.action === "open" && order.side === "buy"
    ? Math.max(0, Number(order.reservedCash ?? 0))
    : 0;
}

function accountReservation(accountId: string, portfolios: LivePortfolio[]) {
  return portfolios
    .filter((portfolio) => portfolio.accountId === accountId)
    .reduce((sum, portfolio) => sum + portfolio.pendingOrders.reduce(
      (subtotal, order) => subtotal + orderReservation(order as Record<string, unknown>),
      0,
    ), 0);
}

function withAccountState(account: LiveAccount, portfolios: LivePortfolio[], version: number) {
  const reservedCash = accountReservation(account.id, portfolios);
  return {
    ...account,
    reservedCash,
    availableCash: account.tradingMode === "capital" ? liveAccountAvailableCash({ cashBalance: account.cashBalance, reservedCash }) : 0,
    version,
    updatedAt: new Date().toISOString(),
  };
}

function withPortfolioAccountState(
  portfolio: LivePortfolio,
  account: LiveAccount,
  version: number,
) {
  return {
    ...portfolio,
    accountId: account.id,
    accountVersion: version,
    tradingMode: account.tradingMode,
    initialCapital: account.tradingMode === "capital" ? account.initialCapital : account.riskCapital,
    cashBalance: account.cashBalance,
    updatedAt: new Date().toISOString(),
  };
}

function accountActivity(state: LiveState, accountId: string) {
  const linkedPortfolios = state.portfolios.filter((portfolio) => portfolio.accountId === accountId);
  return {
    linkedPortfolios,
    pendingCount: linkedPortfolios.reduce((sum, portfolio) => sum + portfolio.pendingOrders.length, 0),
    openPositionCount: linkedPortfolios.reduce(
      (sum, portfolio) => sum + portfolio.positions.filter((position) => position.status === "open").length,
      0,
    ),
  };
}

function newAccountFromCommand(command: TradingCommand, accountId: string, fallback: LiveAccount): LiveAccount {
  const now = new Date().toISOString();
  const market = command.market === "US" ? "US" : "CN";
  const tradingMode = command.tradingMode ?? fallback.tradingMode;
  const configuredCapital = Math.max(
    0,
    Number(command.initialCapital ?? command.riskCapital ?? (
      tradingMode === "capital" ? fallback.initialCapital : fallback.riskCapital
    )),
  );
  return {
    id: accountId,
    market,
    currency: liveAccountCurrencyForMarket(market),
    displayName: command.displayName ?? (market === "CN" ? "A 股实时模拟账户" : "美股实时模拟账户"),
    status: "active" as const,
    tradingMode,
    initialCapital: tradingMode === "capital" ? configuredCapital : 0,
    riskCapital: tradingMode === "return" ? configuredCapital : 0,
    cashBalance: tradingMode === "capital" ? configuredCapital : 0,
    reservedCash: 0,
    reservedMargin: 0,
    equity: configuredCapital,
    availableCash: tradingMode === "capital" ? configuredCapital : 0,
    version: 1,
    payloadVersion: 1,
    executionProfileVersion: command.executionProfileVersion ?? fallback.executionProfileVersion,
    executionProfile: command.executionProfile ?? fallback.executionProfile,
    executionEngineVersion: EXECUTION_ENGINE_VERSION,
    executionSwitchState: "current" as const,
    switchedAt: now,
    previousAccountVersion: fallback.version,
    marketRuleVersion: command.marketRuleVersion ?? fallback.marketRuleVersion,
    dataContractVersion: "live-ohlcv-v1",
    legacyPendingOrderCount: 0,
    carriedPositionCount: 0,
    needsUserAction: false,
    lastProcessedTimestamp: null,
    lastProcessedRevision: null,
    createdAt: now,
    updatedAt: now,
    portfolioInstrumentIds: [],
  };
}

function requirePortfolio(state: LiveState, command: TradingCommand) {
  if (!command.instrumentId) {
    throw new TradingCommandError("invalid_command", "该交易命令缺少品种");
  }
  const portfolio = state.portfolios.find((item) => (
    item.instrumentId === command.instrumentId && item.accountId === command.accountId
  ));
  if (!portfolio) throw new TradingCommandError("portfolio_not_found", "该品种尚未绑定到当前实时模拟账户");
  return portfolio;
}

function requireOrderFields(command: TradingCommand) {
  if (!command.instrumentId || !command.side || command.qty == null) {
    throw new TradingCommandError("invalid_command", "开仓命令缺少品种、方向或数量");
  }
  if (command.qty <= 0) throw new TradingCommandError("invalid_command", "下单数量必须大于零");
}

function makeOrder(command: TradingCommand, account: LiveAccount, portfolio: LivePortfolio, positionId: string) {
  requireOrderFields(command);
  const qty = command.qty as number;
  const orderId = command.orderId ?? `order:${command.commandId}`;
  const referencePrice = Number(command.triggerPrice ?? portfolio.latestClose);
  const reservedCash = account.tradingMode === "capital" && command.side === "buy"
    ? estimatedBuyCashRequired(referencePrice, qty, account.executionProfile)
    : 0;
  const reservedCashValue = Number.isFinite(reservedCash) ? reservedCash : 0;
  if (account.tradingMode === "capital" && reservedCashValue > liveAccountAvailableCash(account) + 0.000001) {
    throw new TradingCommandError("insufficient_cash", "当前账户可用资金不足，无法提交委托");
  }
  return {
    ...createOpenOrderFromTradingCommand(command, { orderId, positionId }),
    reservedCash: reservedCashValue || undefined,
    reservedMargin: undefined,
    engineVersion: EXECUTION_ENGINE_VERSION,
    ...(command.executionProfileVersion ? { executionProfileVersion: command.executionProfileVersion } : {}),
  };
}

function makeCloseOrder(command: TradingCommand, position: Record<string, unknown>, instrumentId: string) {
  const positionId = String(position.id ?? command.positionId ?? "");
  const qty = Number(command.qty ?? position.qty);
  const side = position.side === "long" || position.side === "short" ? position.side : null;
  if (!positionId || !side || !Number.isFinite(qty) || qty <= 0) {
    throw new TradingCommandError("position_not_found", "待平仓持仓不存在或数量不正确");
  }
  const orderId = command.orderId ?? `order:${command.commandId}:${instrumentId}:${positionId}`;
  return {
    ...createCloseOrderFromTradingCommand({ ...command, qty }, {
      id: positionId,
      side,
      qty: Number(position.qty),
      decisionSubmissionId: typeof position.decisionSubmissionId === "string" ? position.decisionSubmissionId : undefined,
    }, { orderId }),
    ...(command.triggerPrice == null ? {} : { triggerPrice: command.triggerPrice }),
    engineVersion: EXECUTION_ENGINE_VERSION,
  };
}

function createBootstrapPortfolio(account: LiveAccount, command: TradingCommand, now: string): LivePortfolio {
  if (!command.instrumentId || !command.side || command.qty == null) {
    throw new TradingCommandError("invalid_command", "首笔实时下单缺少品种、方向或数量");
  }
  const referencePrice = Number(command.referencePrice);
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    throw new TradingCommandError("invalid_command", "首次实时下单缺少有效参考价");
  }
  const bootstrapPortfolio = {
    id: command.instrumentId,
    instrumentId: command.instrumentId,
    accountId: account.id,
    accountVersion: account.version,
    payloadVersion: 1,
    payload: {},
    lastProcessedTimestamp: undefined,
    lastProcessedRevision: undefined,
    corporateActionEvents: [],
    symbol: command.symbol ?? command.instrumentId,
    name: command.name ?? command.symbol ?? command.instrumentId,
    market: command.market === "US" ? "US" as const : "CN" as const,
    latestTimestamp: command.timestamp,
    latestClose: referencePrice,
    scanTimestamp: command.scanTimestamp ?? command.timestamp,
    presetIds: command.presetIds ?? [],
    presetNames: command.presetNames ?? [],
    positions: [],
    pendingOrders: [],
    executions: [],
    orderRejections: [],
    tradingMode: account.tradingMode,
    initialCapital: account.tradingMode === "capital" ? account.initialCapital : account.riskCapital,
    cashBalance: account.cashBalance,
    decision: undefined,
    decisionSubmissions: [],
    updatedAt: now,
    sortOrder: 0,
  } as LivePortfolio;
  const order = makeOrder(command, account, bootstrapPortfolio, command.positionId ?? `position:${command.commandId}`);
  return { ...bootstrapPortfolio, pendingOrders: [order] };
}

function addCloseOrder(portfolio: LivePortfolio, command: TradingCommand, position: Record<string, unknown>, suffix: string) {
  const order = makeCloseOrder({ ...command, orderId: `order:${command.commandId}:${suffix}` }, position, portfolio.instrumentId);
  return { ...portfolio, pendingOrders: [...portfolio.pendingOrders, order] };
}

export async function applyLiveTradingCommand(db: D1Database, value: unknown): Promise<LiveTradingCommandResult> {
  const command = normalizeTradingCommand(value);
  if (command.environment !== "live" || (command.market !== "CN" && command.market !== "US")) {
    throw new TradingCommandError("invalid_command", "当前命令入口只接受实时模拟交易命令");
  }
  const serializedCommand = commandJson(command);
  const existing = await readReceipt(db, command.commandId);
  if (existing) {
    if (existing.commandJson !== serializedCommand) {
      throw new TradingCommandError("duplicate_command_conflict", "命令编号已被其他交易命令使用");
    }
    return { ...(JSON.parse(existing.resultJson) as LiveTradingCommandResult), idempotent: true };
  }

  const state = await readLiveState(db);
  if (command.type === "create-account") {
    if (state.accounts.some((item) => item.id === command.accountId)) {
      throw new TradingCommandError("account_version_conflict", "实时模拟账户已经存在");
    }
    if (state.accounts.some((item) => item.market === command.market && item.status === "active")) {
      throw new TradingCommandError("account_version_conflict", "该市场已经存在活动账户，请先结束或归档当前账户");
    }
    const now = new Date().toISOString();
    const tradingMode = command.tradingMode ?? "return";
    const configuredCapital = Math.max(0, Number(command.initialCapital ?? command.riskCapital ?? 0));
    let account: LiveAccount = {
      id: command.accountId,
      market: command.market,
      currency: liveAccountCurrencyForMarket(command.market),
      displayName: command.displayName ?? (command.market === "CN" ? "A 股实时模拟账户" : "美股实时模拟账户"),
      status: "active",
      tradingMode,
      initialCapital: tradingMode === "capital" ? configuredCapital : 0,
      riskCapital: tradingMode === "return" ? configuredCapital : 0,
      cashBalance: tradingMode === "capital" ? configuredCapital : 0,
      reservedCash: 0,
      reservedMargin: 0,
      equity: configuredCapital,
      availableCash: tradingMode === "capital" ? configuredCapital : 0,
      version: 1,
      payloadVersion: 1,
      executionProfileVersion: command.executionProfileVersion ?? null,
      executionProfile: command.executionProfile ?? {},
      executionEngineVersion: EXECUTION_ENGINE_VERSION,
      executionSwitchState: "current",
      switchedAt: now,
      previousAccountVersion: null,
      marketRuleVersion: command.marketRuleVersion ?? null,
      dataContractVersion: "live-ohlcv-v1",
      legacyPendingOrderCount: 0,
      carriedPositionCount: 0,
      needsUserAction: false,
      lastProcessedTimestamp: null,
      lastProcessedRevision: null,
      createdAt: now,
      updatedAt: now,
      portfolioInstrumentIds: [],
    };
    let portfolio: LivePortfolio | null = null;
    if (command.instrumentId && command.side && command.qty != null) {
      portfolio = createBootstrapPortfolio(account, command, now);
      account = {
        ...withAccountState(account, [portfolio], account.version),
        portfolioInstrumentIds: [command.instrumentId],
      };
    }
    const saved = await applyLiveStatePatch(db, {
      atomic: true,
      accountUpserts: [account], portfolioUpserts: portfolio ? [portfolio] : [], portfolioDeletes: [],
      watchlistUpserts: [], watchlistDeletes: [],
    });
    if (saved.accountUpdated !== 1) throw new TradingCommandError("account_version_conflict", "账户创建冲突，请刷新后重试");
    const result: LiveTradingCommandResult = {
      accepted: true,
      commandId: command.commandId,
      idempotent: false,
      accountVersion: account.version,
      account,
      portfolios: portfolio ? [portfolio] : [],
    };
    await writeReceipt(db, command, serializedCommand, result);
    return result;
  }
  const account = state.accounts.find((item) => item.id === command.accountId);
  if (!account) throw new TradingCommandError("account_not_found", "实时模拟账户不存在");
  if (account.version !== command.observedAccountVersion) {
    throw new TradingCommandError("account_version_conflict", "账户状态已更新，请刷新账户后重试");
  }

  if (command.type === "attach-portfolio") {
    if (account.status !== "active") throw new TradingCommandError("account_paused", "当前实时模拟账户已暂停交易");
    if (!command.instrumentId) throw new TradingCommandError("invalid_command", "绑定品种命令缺少品种");
    if (state.portfolios.some((item) => item.accountId === account.id && item.instrumentId === command.instrumentId)) {
      throw new TradingCommandError("account_version_conflict", "该品种已经绑定到当前实时模拟账户");
    }
    const now = new Date().toISOString();
    const nextVersion = account.version + 1;
    const portfolio = createBootstrapPortfolio({ ...account, version: nextVersion }, command, now);
    const nextAccount = {
      ...withAccountState(account, [...state.portfolios, portfolio], nextVersion),
      portfolioInstrumentIds: [...new Set([...account.portfolioInstrumentIds, command.instrumentId])],
    };
    const saved = await applyLiveStatePatch(db, {
      atomic: true,
      accountUpserts: [nextAccount],
      portfolioUpserts: [{ ...portfolio, accountVersion: nextVersion }],
      portfolioDeletes: [],
      watchlistUpserts: [],
      watchlistDeletes: [],
    });
    if (saved.accountUpdated !== 1) throw new TradingCommandError("account_version_conflict", "账户状态已更新，请刷新账户后重试");
    const result: LiveTradingCommandResult = {
      accepted: true,
      commandId: command.commandId,
      idempotent: false,
      accountVersion: nextVersion,
      account: nextAccount,
      portfolios: [portfolio],
    };
    await writeReceipt(db, command, serializedCommand, result);
    return result;
  }

  if (["pause-account", "resume-account", "end-account", "archive-account", "reset-account", "switch-account"].includes(command.type)) {
    if (command.type === "resume-account" && account.status === "archived") {
      throw new TradingCommandError("account_paused", "已归档账户不能直接恢复，请新建账户");
    }
    const activity = accountActivity(state, account.id);
    const pendingCount = activity.pendingCount;
    const carriedPositionCount = activity.openPositionCount;
    if (command.type === "archive-account" && (pendingCount > 0 || carriedPositionCount > 0)) {
      throw new TradingCommandError("account_has_activity", "账户仍有待成交委托或持仓，请先处理后再归档");
    }
    if (command.type === "reset-account" && (pendingCount > 0 || carriedPositionCount > 0)) {
      throw new TradingCommandError("account_has_activity", "账户仍有待成交委托或持仓，不能静默重置");
    }
    if (command.type === "reset-account") {
      const newAccountId = command.newAccountId;
      if (!newAccountId || newAccountId === account.id) {
        throw new TradingCommandError("invalid_command", "重置命令缺少新的账户编号");
      }
      if (state.accounts.some((item) => item.id === newAccountId)) {
        throw new TradingCommandError("account_version_conflict", "新的实时模拟账户已经存在");
      }
      const archivedAccount = {
        ...withAccountState(account, state.portfolios, account.version + 1),
        status: "archived" as const,
        needsUserAction: false,
        legacyPendingOrderCount: 0,
        carriedPositionCount: 0,
      };
      const nextAccount = newAccountFromCommand(command, newAccountId, account);
      const saved = await applyLiveStatePatch(db, {
        atomic: true,
        accountUpserts: [archivedAccount, nextAccount], portfolioUpserts: [], portfolioDeletes: [],
        watchlistUpserts: [], watchlistDeletes: [],
      });
      if (saved.accountUpdated !== 2) {
        throw new TradingCommandError("account_version_conflict", "账户重置发生并发变化，请刷新后重试");
      }
      const result: LiveTradingCommandResult = {
        accepted: true,
        commandId: command.commandId,
        idempotent: false,
        accountVersion: nextAccount.version,
        account: nextAccount,
        portfolios: [],
      };
      await writeReceipt(db, command, serializedCommand, result);
      return result;
    }
    const nextVersion = account.version + 1;
    let nextAccount = withAccountState(account, state.portfolios, nextVersion);
    if (command.type === "pause-account") nextAccount = { ...nextAccount, status: "paused" };
    if (command.type === "resume-account") nextAccount = { ...nextAccount, status: "active" };
    if (command.type === "end-account") {
      nextAccount = pendingCount > 0 || carriedPositionCount > 0
        ? {
          ...nextAccount,
          status: "ending",
          needsUserAction: true,
          legacyPendingOrderCount: pendingCount,
          carriedPositionCount,
        }
        : { ...nextAccount, status: "archived", needsUserAction: false };
    }
    if (command.type === "archive-account") nextAccount = { ...nextAccount, status: "archived", needsUserAction: false };
    if (command.type === "switch-account") {
      if (pendingCount > 0) {
        nextAccount = {
          ...nextAccount,
          status: "paused",
          executionSwitchState: "pending",
          needsUserAction: true,
          legacyPendingOrderCount: pendingCount,
          carriedPositionCount,
        };
      } else {
        nextAccount = {
          ...nextAccount,
          status: "active",
          executionEngineVersion: EXECUTION_ENGINE_VERSION,
          executionSwitchState: "current",
          switchedAt: new Date().toISOString(),
          previousAccountVersion: account.version,
          legacyPendingOrderCount: 0,
          carriedPositionCount,
          needsUserAction: false,
        };
      }
    }
    const saved = await applyLiveStatePatch(db, {
      atomic: true,
      accountUpserts: [nextAccount], portfolioUpserts: [], portfolioDeletes: [],
      watchlistUpserts: [], watchlistDeletes: [],
    });
    if (saved.accountUpdated !== 1) throw new TradingCommandError("account_version_conflict", "账户状态已更新，请刷新后重试");
    const result: LiveTradingCommandResult = {
      accepted: true,
      commandId: command.commandId,
      idempotent: false,
      accountVersion: nextAccount.version,
      account: nextAccount,
      portfolios: [],
    };
    await writeReceipt(db, command, serializedCommand, result);
    return result;
  }
  if (account.status !== "active") throw new TradingCommandError("account_paused", "当前实时模拟账户已暂停交易");

  let nextPortfolios = [...state.portfolios];
  const target = command.type === "close-all"
    ? undefined
    : requirePortfolio(state, command);
  const targetIndex = target ? nextPortfolios.findIndex((item) => item.instrumentId === target.instrumentId) : -1;
  const nextVersion = account.version + 1;

  if (command.type === "submit-order") {
    requireOrderFields(command);
    const order = makeOrder(command, account, target!, `position:${command.commandId}`);
    nextPortfolios[targetIndex] = {
      ...target!,
      pendingOrders: [...target!.pendingOrders, order],
    };
  } else if (command.type === "cancel-order") {
    nextPortfolios[targetIndex] = {
      ...target!,
      pendingOrders: cancelPendingOrderFromTradingCommand(target!.pendingOrders, command),
    };
  } else if (command.type === "modify-protection") {
    nextPortfolios[targetIndex] = {
      ...target!,
      positions: modifyProtectionFromTradingCommand(target!.positions, command),
    };
  } else if (command.type === "close-position") {
    if (!command.positionId) throw new TradingCommandError("invalid_command", "平仓命令缺少持仓编号");
    const position = target!.positions.find((item) => item.id === command.positionId && item.status === "open");
    if (!position) throw new TradingCommandError("position_not_found", "待平仓持仓不存在");
    if (target!.pendingOrders.some((order) => order.action === "close" && order.positionId === command.positionId)) {
      throw new TradingCommandError("order_not_found", "该持仓已经存在待成交平仓委托");
    }
    nextPortfolios[targetIndex] = addCloseOrder(target!, command, position as Record<string, unknown>, command.positionId);
  } else if (command.type === "close-all") {
    nextPortfolios = nextPortfolios.map((portfolio) => {
      if (portfolio.accountId !== account.id || portfolio.market !== account.market) return portfolio;
      let next = portfolio;
      for (const position of portfolio.positions.filter((item) => item.status === "open")) {
        if (next.pendingOrders.some((order) => order.action === "close" && order.positionId === position.id)) continue;
        next = addCloseOrder(next, command, position as Record<string, unknown>, `${portfolio.instrumentId}:${position.id}`);
      }
      return next;
    });
  }

  const nextAccount = withAccountState(account, nextPortfolios, nextVersion);
  const portfolioUpserts = nextPortfolios
    .filter((portfolio, index) => portfolio !== state.portfolios[index] && portfolio.accountId === account.id)
    .map((portfolio) => withPortfolioAccountState(portfolio, nextAccount, nextVersion));
  const saved = await applyLiveStatePatch(db, {
    atomic: true,
    accountUpserts: [nextAccount],
    portfolioUpserts,
    portfolioDeletes: [],
    watchlistUpserts: [],
    watchlistDeletes: [],
  });
  if (saved.accountUpdated !== 1) {
    throw new TradingCommandError("account_version_conflict", "账户状态已更新，请刷新账户后重试");
  }
  const result: LiveTradingCommandResult = {
    accepted: true,
    commandId: command.commandId,
    idempotent: false,
    accountVersion: nextAccount.version,
    account: nextAccount,
    portfolios: portfolioUpserts,
  };
  await writeReceipt(db, command, serializedCommand, result);
  return result;
}
