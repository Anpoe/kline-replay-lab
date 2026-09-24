import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { applyLiveStatePatch, readLiveState } from "../db/live-ledger.ts";
import { applyLiveTradingCommand } from "../db/live-command.ts";

function createD1(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE live_accounts (
      account_id TEXT PRIMARY KEY, market TEXT, currency TEXT, display_name TEXT, status TEXT,
      trading_mode TEXT, initial_capital REAL, risk_capital REAL, cash_balance REAL,
      reserved_cash REAL, reserved_margin REAL, equity REAL, available_cash REAL,
      account_version INTEGER, payload_version INTEGER, payload_json TEXT, settings_json TEXT,
      execution_profile_json TEXT, execution_profile_version TEXT, last_processed_timestamp INTEGER,
      execution_engine_version TEXT, execution_switch_state TEXT, switched_at TEXT,
      previous_account_version INTEGER, market_rule_version TEXT, data_contract_version TEXT,
      legacy_pending_order_count INTEGER, carried_position_count INTEGER, needs_user_action INTEGER,
      last_processed_revision TEXT, created_at TEXT, updated_at TEXT, archived_at TEXT
    );
    CREATE TABLE live_portfolios (
      instrument_id TEXT PRIMARY KEY, account_id TEXT, symbol TEXT, name TEXT, market TEXT,
      latest_timestamp INTEGER, latest_close REAL, scan_timestamp INTEGER, preset_ids_json TEXT,
      preset_names_json TEXT, decision_json TEXT, decision_submissions_json TEXT,
      trading_mode TEXT, initial_capital REAL, cash_balance REAL, account_version INTEGER,
      payload_version INTEGER, payload_json TEXT, last_processed_timestamp INTEGER,
      last_processed_revision TEXT, corporate_action_events_json TEXT DEFAULT '[]', updated_at TEXT, sort_order INTEGER
    );
    CREATE TABLE live_positions (
      id TEXT PRIMARY KEY, account_id TEXT, portfolio_instrument_id TEXT, side TEXT, qty REAL,
      entry_price REAL, entry_timestamp INTEGER, entry_order_id TEXT, entry_order_type TEXT,
      entry_intrabar INTEGER, status TEXT, exit_price REAL, exit_timestamp INTEGER,
      exit_order_id TEXT, realized_pnl REAL, gross_realized_pnl REAL, entry_fee REAL,
      exit_fee REAL, total_fees REAL, stop_loss REAL, take_profit REAL, initial_risk REAL,
      exit_reason TEXT, intrabar_ambiguous INTEGER, engine_version TEXT, sizing_mode TEXT,
      risk_percent REAL, risk_budget REAL, margin_used REAL, payload_version INTEGER, payload_json TEXT
    );
    CREATE TABLE live_pending_orders (
      id TEXT PRIMARY KEY, account_id TEXT, portfolio_instrument_id TEXT, action TEXT, side TEXT,
      qty REAL, created_at INTEGER, position_id TEXT, rule_id TEXT, rule_version TEXT,
      price_band_json TEXT, reserved_cash REAL, status TEXT, execute_at_timestamp INTEGER,
      order_type TEXT, trigger_price REAL, original_qty REAL, filled_qty REAL, remaining_qty REAL,
      stop_loss REAL, take_profit REAL, sizing_mode TEXT, risk_percent REAL, risk_budget REAL,
      reserved_margin REAL, engine_version TEXT, payload_version INTEGER, payload_json TEXT
    );
    CREATE TABLE live_executions (
      id TEXT PRIMARY KEY, account_id TEXT, portfolio_instrument_id TEXT, order_id TEXT,
      position_id TEXT, action TEXT, side TEXT, qty REAL, price REAL, timestamp INTEGER,
      realized_pnl REAL, rule_id TEXT, rule_version TEXT, raw_price REAL, quote_price REAL,
      quote_side TEXT, fee REAL, price_impact_cost REAL, order_type TEXT, trigger_price REAL,
      reason TEXT, intrabar_ambiguous INTEGER, partial INTEGER, remaining_qty REAL,
      notional_value REAL, margin_impact REAL, account_currency TEXT, engine_version TEXT,
      payload_version INTEGER, payload_json TEXT
    );
    CREATE TABLE live_order_rejections (
      id TEXT PRIMARY KEY, account_id TEXT, portfolio_instrument_id TEXT, order_id TEXT,
      code TEXT, message TEXT, timestamp INTEGER, rule_id TEXT, rule_version TEXT,
      payload_version INTEGER, payload_json TEXT
    );
    CREATE TABLE live_watchlist (
      instrument_id TEXT PRIMARY KEY, symbol TEXT, name TEXT, market TEXT, latest_timestamp INTEGER,
      latest_close REAL, observation_timestamp INTEGER, observation_close REAL, entry_timestamp INTEGER,
      entry_price REAL, scan_timestamp INTEGER, preset_ids_json TEXT, preset_names_json TEXT,
      updated_at TEXT, sort_order INTEGER
    );
    CREATE TABLE live_command_receipts (
      command_id TEXT PRIMARY KEY, account_id TEXT, command_type TEXT,
      command_json TEXT, result_json TEXT, created_at TEXT
    );
  `);
  const db = {
    prepare(sql) {
      const execute = (method, values) => sqlite.prepare(sql)[method](...values);
      return {
        bind(...values) {
          return {
            async run() {
              const result = execute("run", values);
              return { meta: { changes: Number(result.changes ?? 0) } };
            },
            async all() { return { results: execute("all", values) }; },
            async first() { return execute("get", values) ?? null; },
          };
        },
        async run() {
          const result = execute("run", []);
          return { meta: { changes: Number(result.changes ?? 0) } };
        },
        async all() { return { results: execute("all", []) }; },
        async first() { return execute("get", []) ?? null; },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { db, sqlite };
}

test("live ledger round-trips full order, position, fill and rejection fields", async (t) => {
  const { db } = createD1(t);
  const now = "2026-09-23T00:00:00.000Z";
  const account = {
    id: "live-account-CN", market: "CN", currency: "CNY", displayName: "A 股实时模拟账户",
    status: "active", tradingMode: "capital", initialCapital: 100000, riskCapital: 0,
    cashBalance: 99900, reservedCash: 100, reservedMargin: 0, equity: 100100,
    availableCash: 99800, version: 2, payloadVersion: 1, executionProfileVersion: "profile-1",
    executionProfile: { commissionRateBps: 2 }, lastProcessedTimestamp: 10,
    lastProcessedRevision: "rev-1", createdAt: now, updatedAt: now, portfolioInstrumentIds: ["600519.SH"],
  };
  const portfolio = {
    id: "600519.SH", instrumentId: "600519.SH", accountId: account.id, symbol: "600519.SH",
    name: "贵州茅台", market: "CN", latestTimestamp: 10, latestClose: 1000, scanTimestamp: 10,
    presetIds: [], presetNames: [], tradingMode: "capital", initialCapital: 100000, cashBalance: 99900,
    accountVersion: 2, payloadVersion: 1, lastProcessedTimestamp: 10, lastProcessedRevision: "rev-1",
    corporateActionEvents: [{ eventId: "600519.SH:2026-03-11:1", status: "applied", amount: 20 }],
    decisionSubmissions: [], updatedAt: now, positions: [{
      id: "position-1", side: "long", qty: 100, entryPrice: 990, entryTimestamp: 9,
      entryOrderId: "order-1", entryOrderType: "limit", entryIntrabar: true, status: "open",
      stopLoss: 950, takeProfit: 1050, initialRisk: 4000, entryFee: 2, totalFees: 2,
      engineVersion: "engine-1", sizingMode: "risk-percent", riskPercent: 1, riskBudget: 1000,
      marginUsed: 0,
    }],
    pendingOrders: [{
      id: "order-2", action: "open", side: "buy", qty: 10, originalQty: 20, filledQty: 10,
      remainingQty: 10, createdAt: 10, positionId: "position-2", status: "pending", orderType: "stop",
      triggerPrice: 1010, stopLoss: 980, takeProfit: 1100, sizingMode: "fixed", reservedCash: 100,
      reservedMargin: 0, engineVersion: "engine-1", ruleId: "cn", ruleVersion: "v1",
    }],
    executions: [{
      id: "fill-1", orderId: "order-1", positionId: "position-1", action: "open", side: "buy",
      qty: 100, price: 990, rawPrice: 989, quotePrice: 989.5, quoteSide: "mid", timestamp: 9,
      realizedPnl: 0, grossRealizedPnl: 0, fee: 2, priceImpactCost: 1, orderType: "limit",
      triggerPrice: 990, reason: "order", partial: false, notionalValue: 99000, marginImpact: 0,
      accountCurrency: "CNY", engineVersion: "engine-1", barEvidence: {
        timestamp: 9, open: 995, high: 1000, low: 985, close: 990, volume: 100000,
        revision: "rev-1", closed: true,
      },
    }],
    orderRejections: [{
      id: "reject-1", orderId: "order-3", code: "price_limit", message: "涨停限制", timestamp: 10,
      ruleId: "cn", ruleVersion: "v1", barEvidence: { timestamp: 10, open: 1000, high: 1100, low: 990, close: 1090 },
    }],
  };
  await applyLiveStatePatch(db, {
    accountUpserts: [account], portfolioUpserts: [portfolio], portfolioDeletes: [],
    watchlistUpserts: [], watchlistDeletes: [],
  });
  const state = await readLiveState(db);
  const saved = state.portfolios[0];
  assert.equal(saved.pendingOrders[0].triggerPrice, 1010);
  assert.equal(saved.pendingOrders[0].remainingQty, 10);
  assert.equal(saved.positions[0].initialRisk, 4000);
  assert.equal(saved.positions[0].entryIntrabar, true);
  assert.equal(saved.executions[0].rawPrice, 989);
  assert.equal(saved.executions[0].barEvidence.revision, "rev-1");
  assert.equal(saved.orderRejections[0].barEvidence.close, 1090);
  assert.equal(saved.corporateActionEvents[0].eventId, "600519.SH:2026-03-11:1");
});

test("live command receipts make account lifecycle commands idempotent", async (t) => {
  const { db } = createD1(t);
  const create = {
    commandId: "create-account-command",
    type: "create-account",
    environment: "live",
    accountId: "live-account-US",
    market: "US",
    timestamp: 1,
    observedAccountVersion: 0,
    tradingMode: "capital",
    initialCapital: 50_000,
    executionProfileVersion: "profile-1",
    executionProfile: { commissionRateBps: 2 },
  };
  const first = await applyLiveTradingCommand(db, create);
  assert.equal(first.account.version, 1);
  assert.equal(first.account.executionSwitchState, "current");
  const replay = await applyLiveTradingCommand(db, create);
  assert.equal(replay.idempotent, true);
  const paused = await applyLiveTradingCommand(db, {
    commandId: "pause-account-command",
    type: "pause-account",
    environment: "live",
    accountId: "live-account-US",
    market: "US",
    timestamp: 2,
    observedAccountVersion: 1,
  });
  assert.equal(paused.account.status, "paused");
  assert.equal(paused.account.version, 2);
});

test("first shared order bootstraps a portfolio and reset never silently drops activity", async (t) => {
  const { db } = createD1(t);
  const create = await applyLiveTradingCommand(db, {
    commandId: "bootstrap-order-command",
    type: "create-account",
    environment: "live",
    accountId: "live-account-CN",
    market: "CN",
    instrumentId: "600519.SH",
    symbol: "600519",
    name: "贵州茅台",
    referencePrice: 1000,
    timestamp: 10,
    observedAccountVersion: 0,
    tradingMode: "capital",
    initialCapital: 100_000,
    side: "buy",
    qty: 100,
    orderType: "market",
  });
  assert.equal(create.portfolios.length, 1);
  assert.equal(create.portfolios[0].pendingOrders.length, 1);
  assert.equal(create.account.reservedCash > 0, true);

  await assert.rejects(
    () => applyLiveTradingCommand(db, {
      commandId: "reset-with-activity",
      type: "reset-account",
      environment: "live",
      accountId: "live-account-CN",
      market: "CN",
      timestamp: 11,
      observedAccountVersion: 1,
      newAccountId: "live-account-CN:next",
    }),
    (error) => error?.code === "account_has_activity",
  );

  const cancelled = await applyLiveTradingCommand(db, {
    commandId: "cancel-bootstrap-order",
    type: "cancel-order",
    environment: "live",
    accountId: "live-account-CN",
    market: "CN",
    instrumentId: "600519.SH",
    timestamp: 11,
    observedAccountVersion: 1,
    orderId: create.portfolios[0].pendingOrders[0].id,
  });
  assert.equal(cancelled.account.version, 2);

  const reset = await applyLiveTradingCommand(db, {
    commandId: "reset-empty-account",
    type: "reset-account",
    environment: "live",
    accountId: "live-account-CN",
    market: "CN",
    timestamp: 12,
    observedAccountVersion: 2,
    newAccountId: "live-account-CN:next",
    tradingMode: "capital",
    initialCapital: 80_000,
  });
  assert.equal(reset.account.id, "live-account-CN:next");
  assert.equal(reset.account.version, 1);
  const state = await readLiveState(db);
  assert.equal(state.accounts.find((item) => item.id === "live-account-CN").status, "archived");
  assert.equal(state.accounts.find((item) => item.id === "live-account-CN:next").status, "active");

  const attached = await applyLiveTradingCommand(db, {
    commandId: "attach-second-instrument",
    type: "attach-portfolio",
    environment: "live",
    accountId: reset.account.id,
    market: "CN",
    instrumentId: "000001.SZ",
    symbol: "000001",
    name: "平安银行",
    referencePrice: 12,
    timestamp: 13,
    observedAccountVersion: reset.account.version,
    side: "buy",
    qty: 100,
    orderType: "market",
  });
  assert.equal(attached.portfolios[0].instrumentId, "000001.SZ");
  assert.equal(attached.account.portfolioInstrumentIds.includes("000001.SZ"), true);
});
