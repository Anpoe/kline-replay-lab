import type { ExecutionCostProfile, OrderType } from "./executionEngine.ts";
import { normalizeFxAccountConfig, type FxAccountConfig } from "./fxTrading.ts";
import { entryProtectionError, pendingPriceError } from "./orderPriceValidation.ts";

export const TRADING_COMMAND_VERSION = "2026.09-v1";

export type TradingCommandType =
  | "create-account"
  | "pause-account"
  | "resume-account"
  | "end-account"
  | "archive-account"
  | "reset-account"
  | "switch-account"
  | "attach-portfolio"
  | "submit-order"
  | "cancel-order"
  | "modify-protection"
  | "modify-order"
  | "close-position"
  | "close-all";

export type TradingCommand = {
  version: string;
  commandId: string;
  type: TradingCommandType;
  environment: "live" | "training";
  accountId: string;
  market: "CN" | "US" | "FX" | "GOLD";
  instrumentId?: string;
  symbol?: string | null;
  name?: string | null;
  referencePrice?: number | null;
  scanTimestamp?: number | null;
  presetIds?: string[];
  presetNames?: string[];
  timestamp: number;
  observedAccountVersion: number;
  observedMarketRevision?: string | null;
  executeAtTimestamp?: number | null;
  displayName?: string | null;
  newAccountId?: string | null;
  tradingMode?: "return" | "capital";
  initialCapital?: number | null;
  riskCapital?: number | null;
  positionId?: string;
  orderId?: string;
  side?: "buy" | "sell";
  qty?: number;
  orderType?: OrderType;
  triggerPrice?: number | null;
  expectedTriggerPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  sizingMode?: "fixed" | "risk-percent";
  riskPercent?: number | null;
  riskBudget?: number | null;
  openingGapMode?: "off" | "high" | "low";
  openingGapUnit?: "percent" | "price";
  openingGapThreshold?: number | null;
  openingGapReferencePrice?: number | null;
  decisionSubmissionId?: string | null;
  marketRuleId?: string | null;
  marketRuleVersion?: string | null;
  executionProfile?: Partial<ExecutionCostProfile>;
  executionProfileVersion?: string | null;
  fxAccountConfig?: FxAccountConfig;
};

export type TradingCommandErrorCode =
  | "invalid_command"
  | "account_not_found"
  | "account_paused"
  | "account_has_activity"
  | "portfolio_not_found"
  | "account_version_conflict"
  | "position_not_found"
  | "order_not_found"
  | "insufficient_cash"
  | "insufficient_margin"
  | "duplicate_command_conflict";

export class TradingCommandError extends Error {
  readonly code: TradingCommandErrorCode;

  constructor(code: TradingCommandErrorCode, message: string) {
    super(message);
    this.name = "TradingCommandError";
    this.code = code;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown) {
  const result = stringValue(value);
  return result || null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableNumber(value: unknown) {
  const result = finiteNumber(value);
  return result == null ? null : result;
}

function normalizeExecutionProfile(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Partial<ExecutionCostProfile>;
}

export function normalizeTradingCommand(value: unknown): TradingCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TradingCommandError("invalid_command", "交易命令格式不正确");
  }
  const record = value as Record<string, unknown>;
  const commandId = stringValue(record.commandId);
  const type = record.type;
  const environment = record.environment;
  const accountId = stringValue(record.accountId);
  const market = record.market;
  const timestamp = finiteNumber(record.timestamp);
  const observedAccountVersion = finiteNumber(record.observedAccountVersion);
  if (!commandId || commandId.length > 160
    || !["create-account", "pause-account", "resume-account", "end-account", "archive-account", "reset-account", "switch-account", "attach-portfolio", "submit-order", "cancel-order", "modify-protection", "modify-order", "close-position", "close-all"].includes(String(type))
    || (environment !== "live" && environment !== "training")
    || !accountId
    || (market !== "CN" && market !== "US" && market !== "FX" && market !== "GOLD")
    || timestamp == null || timestamp <= 0
    || observedAccountVersion == null || observedAccountVersion < 0) {
    throw new TradingCommandError("invalid_command", "交易命令缺少账户、市场、时间或版本信息");
  }
  const orderType = record.orderType == null ? undefined : record.orderType;
  if (orderType !== undefined && orderType !== "market" && orderType !== "limit" && orderType !== "stop") {
    throw new TradingCommandError("invalid_command", "委托类型不正确");
  }
  const side = record.side == null ? undefined : record.side;
  if (side !== undefined && side !== "buy" && side !== "sell") {
    throw new TradingCommandError("invalid_command", "交易方向不正确");
  }
  const qty = nullableNumber(record.qty);
  if (qty != null && qty <= 0) throw new TradingCommandError("invalid_command", "下单数量必须大于零");
  if (record.openingGapMode !== undefined
    && record.openingGapMode !== "off" && record.openingGapMode !== "high" && record.openingGapMode !== "low") {
    throw new TradingCommandError("invalid_command", "跳空过滤方向不正确");
  }
  if (record.openingGapUnit !== undefined
    && record.openingGapUnit !== "percent" && record.openingGapUnit !== "price") {
    throw new TradingCommandError("invalid_command", "跳空过滤单位不正确");
  }
  const openingGapThreshold = nullableNumber(record.openingGapThreshold);
  if (openingGapThreshold != null && openingGapThreshold <= 0) {
    throw new TradingCommandError("invalid_command", "跳空过滤阈值必须大于零");
  }
  const openingGapReferencePrice = nullableNumber(record.openingGapReferencePrice);
  if (openingGapReferencePrice != null && openingGapReferencePrice <= 0) {
    throw new TradingCommandError("invalid_command", "跳空过滤参考价必须大于零");
  }
  return {
    version: stringValue(record.version) || TRADING_COMMAND_VERSION,
    ...(record.fxAccountConfig && typeof record.fxAccountConfig === "object"
      ? { fxAccountConfig: normalizeFxAccountConfig(record.fxAccountConfig as Partial<FxAccountConfig>) } : {}),
    commandId,
    type: type as TradingCommandType,
    environment,
    accountId,
    market,
    ...(stringValue(record.instrumentId) ? { instrumentId: stringValue(record.instrumentId) } : {}),
    ...(record.symbol === undefined ? {} : { symbol: nullableString(record.symbol) }),
    ...(record.name === undefined ? {} : { name: nullableString(record.name) }),
    ...(record.referencePrice === undefined ? {} : { referencePrice: nullableNumber(record.referencePrice) }),
    ...(record.scanTimestamp === undefined ? {} : { scanTimestamp: nullableNumber(record.scanTimestamp) }),
    ...(Array.isArray(record.presetIds) ? { presetIds: record.presetIds.filter((item): item is string => typeof item === "string").slice(0, 100) } : {}),
    ...(Array.isArray(record.presetNames) ? { presetNames: record.presetNames.filter((item): item is string => typeof item === "string").slice(0, 100) } : {}),
    timestamp,
    observedAccountVersion,
    ...(record.observedMarketRevision === undefined
      ? {}
      : { observedMarketRevision: nullableString(record.observedMarketRevision) }),
    ...(record.executeAtTimestamp === undefined
      ? {}
      : { executeAtTimestamp: nullableNumber(record.executeAtTimestamp) }),
    ...(record.displayName === undefined ? {} : { displayName: nullableString(record.displayName) }),
    ...(record.newAccountId === undefined ? {} : { newAccountId: nullableString(record.newAccountId) }),
    ...(record.tradingMode === "return" || record.tradingMode === "capital"
      ? { tradingMode: record.tradingMode }
      : {}),
    ...(record.initialCapital === undefined ? {} : { initialCapital: nullableNumber(record.initialCapital) }),
    ...(record.riskCapital === undefined ? {} : { riskCapital: nullableNumber(record.riskCapital) }),
    ...(stringValue(record.positionId) ? { positionId: stringValue(record.positionId) } : {}),
    ...(stringValue(record.orderId) ? { orderId: stringValue(record.orderId) } : {}),
    ...(side ? { side } : {}),
    ...(qty == null ? {} : { qty }),
    ...(orderType ? { orderType } : {}),
    ...(record.triggerPrice === undefined ? {} : { triggerPrice: nullableNumber(record.triggerPrice) }),
    ...(record.expectedTriggerPrice === undefined ? {} : { expectedTriggerPrice: nullableNumber(record.expectedTriggerPrice) }),
    ...(record.stopLoss === undefined ? {} : { stopLoss: nullableNumber(record.stopLoss) }),
    ...(record.takeProfit === undefined ? {} : { takeProfit: nullableNumber(record.takeProfit) }),
    ...(record.sizingMode === "fixed" || record.sizingMode === "risk-percent"
      ? { sizingMode: record.sizingMode }
      : {}),
    ...(record.riskPercent === undefined ? {} : { riskPercent: nullableNumber(record.riskPercent) }),
    ...(record.riskBudget === undefined ? {} : { riskBudget: nullableNumber(record.riskBudget) }),
    ...(record.openingGapMode === "off" || record.openingGapMode === "high" || record.openingGapMode === "low"
      ? { openingGapMode: record.openingGapMode }
      : {}),
    ...(record.openingGapUnit === "percent" || record.openingGapUnit === "price"
      ? { openingGapUnit: record.openingGapUnit }
      : {}),
    ...(record.openingGapThreshold === undefined ? {} : { openingGapThreshold }),
    ...(record.openingGapReferencePrice === undefined ? {} : { openingGapReferencePrice }),
    ...(record.decisionSubmissionId === undefined
      ? {}
      : { decisionSubmissionId: nullableString(record.decisionSubmissionId) }),
    ...(record.marketRuleId === undefined ? {} : { marketRuleId: nullableString(record.marketRuleId) }),
    ...(record.marketRuleVersion === undefined
      ? {}
      : { marketRuleVersion: nullableString(record.marketRuleVersion) }),
    ...(normalizeExecutionProfile(record.executionProfile)
      ? { executionProfile: normalizeExecutionProfile(record.executionProfile) }
      : {}),
    ...(record.executionProfileVersion === undefined
      ? {}
      : { executionProfileVersion: nullableString(record.executionProfileVersion) }),
  };
}

export type TradingCommandOrder = {
  id: string;
  action: "open" | "close";
  side: "buy" | "sell";
  qty: number;
  originalQty: number;
  filledQty: number;
  remainingQty: number;
  createdAt: number;
  positionId: string;
  status: "pending";
  orderType: OrderType;
  executeAtTimestamp?: number;
  triggerPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  sizingMode: "fixed" | "risk-percent";
  riskPercent?: number;
  riskBudget?: number;
  openingGapMode: "off" | "high" | "low";
  openingGapUnit: "percent" | "price";
  openingGapThreshold?: number;
  openingGapReferencePrice?: number;
  decisionSubmissionId?: string;
  ruleId?: string;
  ruleVersion?: string;
};

/** Build the common pending-open-order representation consumed by both adapters. */
export function createOpenOrderFromTradingCommand(
  command: TradingCommand,
  ids: { orderId?: string; positionId?: string } = {},
): TradingCommandOrder {
  if ((command.type !== "submit-order" && command.type !== "create-account" && command.type !== "attach-portfolio")
    || !command.side || command.qty == null || command.qty <= 0) {
    throw new TradingCommandError("invalid_command", "开仓命令缺少有效方向或数量");
  }
  const orderId = ids.orderId ?? command.orderId ?? `order:${command.commandId}`;
  const positionId = ids.positionId ?? command.positionId ?? `position:${command.commandId}`;
  return {
    id: orderId,
    action: "open",
    side: command.side,
    qty: command.qty,
    originalQty: command.qty,
    filledQty: 0,
    remainingQty: command.qty,
    createdAt: command.timestamp,
    positionId,
    status: "pending",
    orderType: command.orderType ?? "market",
    ...(command.triggerPrice == null ? {} : { triggerPrice: command.triggerPrice }),
    ...(command.stopLoss == null ? {} : { stopLoss: command.stopLoss }),
    ...(command.takeProfit == null ? {} : { takeProfit: command.takeProfit }),
    sizingMode: command.sizingMode ?? "fixed",
    ...(command.riskPercent == null ? {} : { riskPercent: command.riskPercent }),
    ...(command.riskBudget == null ? {} : { riskBudget: command.riskBudget }),
    openingGapMode: command.openingGapMode ?? "off",
    openingGapUnit: command.openingGapUnit ?? "percent",
    ...(command.openingGapThreshold == null ? {} : { openingGapThreshold: command.openingGapThreshold }),
    ...(command.openingGapReferencePrice == null ? {} : { openingGapReferencePrice: command.openingGapReferencePrice }),
    ...(command.decisionSubmissionId == null ? {} : { decisionSubmissionId: command.decisionSubmissionId }),
    ...(command.marketRuleId == null ? {} : { ruleId: command.marketRuleId }),
    ...(command.marketRuleVersion == null ? {} : { ruleVersion: command.marketRuleVersion }),
  };
}

/** Build the common pending-close-order representation consumed by both adapters. */
export function createCloseOrderFromTradingCommand(
  command: TradingCommand,
  position: { id: string; side: "long" | "short"; qty: number; decisionSubmissionId?: string },
  ids: { orderId?: string } = {},
): TradingCommandOrder {
  if ((command.type !== "close-position" && command.type !== "close-all")
    || !position.id || !Number.isFinite(position.qty) || position.qty <= 0) {
    throw new TradingCommandError("position_not_found", "平仓命令缺少有效持仓");
  }
  const qty = command.qty ?? position.qty;
  if (!Number.isFinite(qty) || qty <= 0 || qty > position.qty) {
    throw new TradingCommandError("invalid_command", "平仓数量不正确");
  }
  const orderId = ids.orderId ?? command.orderId ?? `order:${command.commandId}`;
  return {
    id: orderId,
    action: "close",
    side: position.side === "long" ? "sell" : "buy",
    qty,
    originalQty: qty,
    filledQty: 0,
    remainingQty: qty,
    createdAt: command.timestamp,
    positionId: position.id,
    status: "pending",
    orderType: command.orderType ?? "market",
    ...(command.executeAtTimestamp == null ? {} : { executeAtTimestamp: command.executeAtTimestamp }),
    sizingMode: "fixed",
    openingGapMode: "off",
    openingGapUnit: "percent",
    ...(position.decisionSubmissionId ? { decisionSubmissionId: position.decisionSubmissionId } : {}),
    ...(command.marketRuleId ? { ruleId: command.marketRuleId } : {}),
    ...(command.marketRuleVersion ? { ruleVersion: command.marketRuleVersion } : {}),
  };
}

export function cancelPendingOrderFromTradingCommand<TOrder extends { id?: unknown }>(
  orders: TOrder[],
  command: TradingCommand,
): TOrder[] {
  if (command.type !== "cancel-order" || !command.orderId) {
    throw new TradingCommandError("invalid_command", "撤单命令缺少委托编号");
  }
  if (!orders.some((order) => order.id === command.orderId)) {
    throw new TradingCommandError("order_not_found", "待撤委托不存在或已经成交");
  }
  return orders.filter((order) => order.id !== command.orderId);
}

export function modifyPendingOrderFromTradingCommand<TOrder extends { id?: unknown; action?: unknown; side?: unknown; orderType?: unknown; triggerPrice?: unknown; stopLoss?: number; takeProfit?: number }>(orders: TOrder[], command: TradingCommand, reference: number, tick = 0): TOrder[] {
  if (command.type !== "modify-order" || !command.orderId) throw new TradingCommandError("invalid_command", "改单命令缺少委托编号");
  const order = orders.find(item => item.id === command.orderId);
  if (!order || order.action !== "open" || (order.orderType !== "limit" && order.orderType !== "stop") || (order.side !== "buy" && order.side !== "sell")) throw new TradingCommandError("order_not_found", "挂单已成交、撤销或不支持修改，请重新读取");
  if (command.expectedTriggerPrice !== order.triggerPrice) throw new TradingCommandError("account_version_conflict", "挂单价格已经变化，请重新打开后修改");
  const price = Number(command.triggerPrice);
  const error = pendingPriceError(order.side, order.orderType, price, reference) || entryProtectionError(order.side, price, order.stopLoss, order.takeProfit);
  if (error) throw new TradingCommandError("invalid_command", error);
  if (tick > 0 && Math.abs(price / tick - Math.round(price / tick)) > 0.00001) throw new TradingCommandError("invalid_command", "价格不符合品种的最小跳动单位");
  return orders.map(item => item === order ? { ...item, triggerPrice: price } : item);
}

export function modifyProtectionFromTradingCommand<TPosition extends {
  id?: unknown;
  status?: unknown;
  action?: unknown;
  side?: unknown;
  triggerPrice?: unknown;
  stopLoss?: unknown;
  takeProfit?: unknown;
}>(
  positions: TPosition[],
  command: TradingCommand,
  targetKind: "position" | "order" = "position",
): TPosition[] {
  const targetId = targetKind === "order" ? command.orderId : command.positionId;
  if (command.type !== "modify-protection" || !targetId) {
    throw new TradingCommandError("invalid_command", targetKind === "order" ? "保护价命令缺少委托编号" : "保护价命令缺少持仓编号");
  }
  if (!positions.some((position) => position.id === targetId && (targetKind === "order" ? position.action === "open" : position.status === "open"))) {
    throw new TradingCommandError(targetKind === "order" ? "order_not_found" : "position_not_found", targetKind === "order" ? "待修改保护价的委托不存在或已经成交" : "待修改保护价的持仓不存在");
  }
  if (targetKind === "order") {
    const order = positions.find(position => position.id === targetId)!;
    if ((order.side === "buy" || order.side === "sell") && Number(order.triggerPrice) > 0) {
      const error = entryProtectionError(order.side, Number(order.triggerPrice), command.stopLoss ?? undefined, command.takeProfit ?? undefined);
      if (error) throw new TradingCommandError("invalid_command", error);
    }
  }
  return positions.map((position) => position.id === targetId
    ? { ...position, stopLoss: command.stopLoss ?? undefined, takeProfit: command.takeProfit ?? undefined }
    : position);
}
