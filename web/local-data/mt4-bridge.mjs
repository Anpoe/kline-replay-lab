import { mt4PeriodEnd } from '../app/lib/mt4History.mjs';
import { randomBytes, timingSafeEqual, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { riskSizedMt4Lots, checkMt4OpeningGap } from "../app/lib/mt4OrderRules.mjs";
import { Mt4Archive, archiveAccountKey } from "./mt4-archive.mjs";

export const MT4_PROTOCOL_VERSION = 1;
const ACTIVE = new Set(["queued", "sent", "unknown"]);
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SYMBOL = /^[\x20-\x21\x23-\x5b\x5d-\x7b\x7d-\x7e]{1,80}$/;
export class Mt4Error extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function requireValue(condition, message, status) { if (!condition) throw new Mt4Error(message, status); }
function number(value, label, minimum = -1e15, maximum = 1e15) {
  requireValue(typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum, `${label}无效`);
  return value;
}
function text(value, label, max = 120) {
  requireValue(typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1f]/.test(value), `${label}无效`);
  return value;
}
function list(value, max, label) { requireValue(Array.isArray(value) && value.length <= max, `${label}无效`); return value; }
export function normalizeOrder(order) {
  requireValue(order && typeof order === "object", "订单无效");
  const result = { ticket: number(order.ticket, "订单号", 1, 2147483647), symbol: text(order.symbol, "品种", 80),
    type: number(order.type, "订单类型", 0, 5), lots: number(order.lots, "手数", 0.000001),
    openPrice: number(order.openPrice, "订单价格", 0), stopLoss: number(order.stopLoss, "止损", 0),
    takeProfit: number(order.takeProfit, "止盈", 0), profit: number(order.profit, "盈亏"),
    swap: number(order.swap, "隔夜费用"), commission: number(order.commission, "手续费"),
    openTime: number(order.openTime, "开仓时间", 0), closeTime: number(order.closeTime, "平仓时间", 0),
    closePrice: number(order.closePrice, "平仓价格", 0), magic: number(order.magic, "订单标记", -2147483648, 2147483647) };
  requireValue(Number.isInteger(result.ticket) && Number.isInteger(result.type), "订单号或类型无效");
  if (order.comment != null) { requireValue(typeof order.comment === 'string' && order.comment.length <= 512, '订单备注无效'); result.comment = order.comment; }
  return result;
}
export function normalizeMt4Snapshot(value) {
  requireValue(value && value.protocolVersion === MT4_PROTOCOL_VERSION, "MT4 连接版本不匹配，请重新下载连接文件");
  const a = value.account;
  requireValue(a && ["demo", "real", "contest"].includes(a.mode), "账户类型无效");
  requireValue(typeof a.connected === "boolean" && typeof a.tradeAllowed === "boolean" && typeof a.allowReal === "boolean", "账户权限无效");
  const login = text(a.login, "账号", 20); requireValue(/^\d+$/.test(login), "账号无效");
  const account = { login, server: text(a.server, "交易服务器"), mode: a.mode, currency: text(a.currency, "币种", 12),
    balance: number(a.balance, "余额"), equity: number(a.equity, "净值"), margin: number(a.margin, "保证金", 0),
    freeMargin: number(a.freeMargin, "可用保证金"), profit: number(a.profit, "浮动盈亏"),
    connected: a.connected, tradeAllowed: a.tradeAllowed, allowReal: a.allowReal };
  const symbols = list(value.symbols, 300, "品种列表").map(s => {
    requireValue(s && typeof s.symbol === "string" && SYMBOL.test(s.symbol), "品种名称无效");
    requireValue(typeof s.tradeAllowed === "boolean", "品种权限无效");
    const symbol = { symbol: s.symbol, digits: number(s.digits, "报价精度", 0, 10), point: number(s.point, "报价单位", 1e-10),
      bid: number(s.bid, "买价报价", 0), ask: number(s.ask, "卖价报价", 0), quoteTime: number(s.quoteTime, "报价时间", 0),
      minLot: number(s.minLot, "最小手数", 0), maxLot: number(s.maxLot, "最大手数", 0), lotStep: number(s.lotStep, "手数步长", 0),
      contractSize: number(s.contractSize, "合约大小", 0), tickValue: number(s.tickValue, "跳动价值", 0),
      tickSize: number(s.tickSize, "跳动单位", 0), stopLevel: number(s.stopLevel, "保护距离", 0),
      freezeLevel: number(s.freezeLevel, "冻结距离", 0), tradeAllowed: s.tradeAllowed };
    requireValue(Number.isInteger(symbol.digits) && symbol.ask >= symbol.bid, "报价无效"); return symbol;
  });
  requireValue(new Set(symbols.map(s => s.symbol)).size === symbols.length, "品种重复");
  const chart = value.chart;
  requireValue(chart && typeof chart.symbol === "string" && SYMBOL.test(chart.symbol) && [1, 5, 15, 30, 60, 240, 1440, 10080, 43200].includes(chart.timeframe), "图表设置无效");
  let previous = 0;
  const bars = list(chart.bars, 600, "K 线").map(b => {
    const bar = { timestamp: number(b.timestamp, "K 线时间", 1), open: number(b.open, "开盘价", 0),
      high: number(b.high, "最高价", 0), low: number(b.low, "最低价", 0), close: number(b.close, "收盘价", 0), volume: number(b.volume, "成交量", 0) };
    requireValue(bar.timestamp > previous && bar.low <= Math.min(bar.open, bar.close) && bar.high >= Math.max(bar.open, bar.close) && bar.low <= bar.high, "K 线数据无效");
    previous = bar.timestamp; return bar;
  });
  const receipts = list(value.receipts, 20, "命令回报").map(r => {
    requireValue(r && ID.test(r.id) && ["succeeded", "failed", "unknown"].includes(r.status), "命令回报无效");
    const ticket = number(r.ticket, "回报订单号", 0, 2147483647);
    requireValue(Number.isInteger(ticket) && typeof r.error === "string" && r.error.length <= 240, "命令回报无效");
    return { id: r.id, status: r.status, ticket, error: r.error };
  });
  const sessionId = text(value.sessionId, "终端标识", 80);
  requireValue(/^[A-Za-z0-9-]+$/.test(sessionId), "终端标识无效");
  return { ...(value.marketPollVersion === 1 ? { marketPollVersion: 1 } : {}), ...(value.commandPollVersion === 1 ? { commandPollVersion: 1 } : {}), protocolVersion: 1, executionVersion: number(value.executionVersion ?? 1, "交易功能版本", 1, 2), sessionId, capturedAt: number(value.capturedAt, "终端时间", 1), account, symbols,
    ...(value.serverUtcOffset == null ? {} : { serverUtcOffset: number(value.serverUtcOffset, "终端时差", -64800, 64800) }),
    orderCount: number(value.orderCount ?? value.orders?.length, "订单总数", 0, 1000000),
    orders: list(value.orders, 500, "活动订单").map(normalizeOrder), history: list(value.history, 50, "成交历史").map(normalizeOrder),
    chart: { symbol: chart.symbol, timeframe: chart.timeframe, bars }, receipts };
}
function accountKey(snapshot) {
  return archiveAccountKey(snapshot.account);
}
function receiptError(receipt) {
  if (receipt.status === "succeeded") return "";
  if (receipt.status === "unknown") return "MT4 执行结果尚未确认，请先核对持仓、挂单及成交历史";
  const errors = { 129: "报价已变化，请刷新报价后重试", 130: "保护价或挂单距离不符合券商规则，请调整价格", 131: "手数不符合券商规则，请检查最小手数与步长",
    132: "市场已休市，请等待交易时段", 133: "券商未允许该品种交易，请检查账户与品种权限", 134: "可用保证金不足，请降低手数或检查账户资金",
    136: "券商报价不可用，请等待行情恢复", 138: "券商重新报价，请刷新报价后重试", 146: "MT4 正在处理其他交易，请读取账户后重试",
    148: "账户订单数量已达券商限制，请先检查已有订单", 4109: "EA 交易权限未开启，请检查 MT4 自动交易与 EA 权限" };
  const code = /^MT4 error (\d+)$/.exec(receipt.error)?.[1];
  if (code) return errors[code] ?? `MT4 拒绝执行（错误 ${code}），请检查终端订单与交易权限后重试`;
  const reasons = {
    "Account or terminal changed; command rejected": "账户或终端已变化，指令未执行；请重新连接并核对账号",
    "Command expired; check current quote": "指令已过期，请重新检查当前报价",
    "Trading permission is disabled or busy": "MT4 未允许交易或正在处理其他订单，请检查权限后重试",
    "Symbol is unavailable for trading": "该品种当前不可交易，请检查 MT4 品种与交易时段",
    "Quote is stale; wait for MT4 update": "报价已过期，请等待 MT4 更新后重试",
    "Invalid protection or slippage": "保护价或滑点设置无效，请调整后重试",
    "Lot size does not match symbol rules": "手数不符合品种规则，请调整手数",
    "Unsupported order type": "订单类型不支持，请重新选择",
    "Pending order price is invalid": "挂单价格无效，请调整后重试",
    "Insufficient free margin": "可用保证金不足，请降低手数或检查账户资金",
    "Order changed; refresh MT4 orders": "订单已变化，请重新读取 MT4 持仓与挂单",
    "Action does not match order type": "订单类型已变化，请重新读取后选择操作",
    "Protection distance or direction is invalid": "保护价方向或距离无效，请按当前报价调整",
    "Risk sizing inputs are invalid": "风险手数计算条件无效，请检查余额、止损和合约跳动价值",
    "Opening gap context changed": "跳空过滤对应的 K 线已变化，请重新读取后提交",
    "Opening gap filter rejected order": "当前开盘跳空不符合买入条件，MT4 未执行该指令",
  };
  return reasons[receipt.error] ?? "MT4 未能执行指令，请检查终端订单、报价与交易权限后重试";
}
export class Mt4Bridge {
  constructor({ root, now = Date.now }) {
    this.directory = path.join(root, "mt4"); this.file = path.join(this.directory, "connection.json"); this.now = now;
    this.state = { version: 1, token: "", commands: [], selection: { symbol: "", timeframe: 5 } };
    this.snapshot = null; this.lastSeen = 0; this.enabled = false; this.chain = Promise.resolve();
    this.uiSession = randomBytes(24).toString("hex");
    this.savedState = "";
    this.dispatchTimes = new Map();
    this.transportError = "";
    this.archive = new Mt4Archive({ directory: this.directory, now });
    this.archiveError = ""; this.archiveScan = null; this.archiveJob = null; this.chartJob = null;
  }
  async init() {
    await mkdir(this.directory, { recursive: true });
    try {
      this.state = JSON.parse(await readFile(this.file, "utf8"));
      requireValue(this.state.version === 1 && Array.isArray(this.state.commands), "MT4 连接记录损坏，请从备份恢复", 503);
      for (const c of this.state.commands) {
        if (c.status === "queued") { c.status = "cancelled"; c.error = "连接已重启，未发送的订单已结束"; }
        if (c.status === "sent") { c.status = "unknown"; c.error = "连接已重启，请先在 MT4 核对执行结果"; }
      }
      await this.save();
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    return this;
  }
  async save() {
    const temporary = `${this.file}.tmp`;
    const serialized = JSON.stringify(this.state);
    await writeFile(temporary, serialized, { mode: 0o600, flush: true });
    await rename(temporary, this.file);
    this.savedState = serialized;
  }
  run(operation) {
    const next = this.chain.then(async () => {
      const before = structuredClone(this.state); const enabled = this.enabled;
      const previousSnapshot = this.snapshot; const previousSeen = this.lastSeen;
      try { const result = await operation(); if (JSON.stringify(this.state) !== this.savedState) await this.save(); return result; }
      catch (error) { this.state = before; this.enabled = enabled; this.snapshot = previousSnapshot; this.lastSeen = previousSeen; throw error; }
    });
    this.chain = next.catch(() => {}); return next;
  }
  stop(reason) {
    this.enabled = false;
    for (const c of this.state.commands) {
      if (c.status === "queued") { c.status = "cancelled"; c.error = reason; }
      else if (c.status === "sent") { c.status = "unknown"; c.error = `${reason}，请先在 MT4 核对执行结果`; }
    }
  }
  expire() {
    if (this.lastSeen && this.now() - this.lastSeen > 15000) this.stop("终端连接中断");
    for (const c of this.state.commands) {
      if (c.status === "queued" && this.now() > c.expiresAt) { c.status = "cancelled"; c.error = "指令已过期，请重新检查报价"; }
      if (c.status === "sent" && this.now() > c.expiresAt + 15000) { c.status = "unknown"; c.error = "执行回报未到达，请先在 MT4 核对结果"; this.enabled = false; }
    }
  }
  status() {
    this.expire();
    return { protocolVersion: 1, paired: Boolean(this.state.token), enabled: this.enabled, transportError: this.transportError,
      connection: !this.state.token ? "unpaired" : !this.snapshot ? "waiting" :
        this.now() - this.lastSeen > 15000 || !this.snapshot.account.connected ? "offline" : "connected",
      lastSeen: this.lastSeen, accountKey: this.snapshot ? accountKey(this.snapshot) : "", snapshot: this.snapshot,
      selection: this.state.selection, commands: this.state.commands.slice(-50).reverse(),
      unresolved: this.state.commands.filter(c => ACTIVE.has(c.status)).length,
      archive: { version: 1, terminalVersion: this.snapshot?.archiveVersion ?? 0, error: this.archiveError, scan: this.archiveScan, chartJob: this.chartJob ? { id: this.chartJob.id, status: this.chartJob.status, error: this.chartJob.error } : null } };
  }
  async ui(payload) {
    return this.run(() => {
      this.expire();
      switch (payload.action) {
        case "pair":
          if (!this.state.token) this.state.token = randomBytes(24).toString("hex");
          return { ...this.status(), token: this.state.token };
        case "reset-pairing":
          requireValue(!this.state.commands.some(c => ACTIVE.has(c.status)), "请先处理未完成的命令，再重新配对", 409);
          this.state.token = randomBytes(24).toString("hex"); this.snapshot = null; this.lastSeen = 0; this.enabled = false;
          return { ...this.status(), token: this.state.token };
        case "select":
          requireValue(this.snapshot?.symbols.some(s => s.symbol === payload.symbol), "请从已连接终端选择品种");
          requireValue([1, 5, 15, 30, 60, 240, 1440, 10080, 43200].includes(payload.timeframe), "周期无效");
          this.state.selection = { symbol: payload.symbol, timeframe: payload.timeframe }; break;
        case "enable": {
          requireValue(this.status().connection === "connected", "请先连接 MT4", 409);
          const a = this.snapshot.account;
          requireValue(payload.accountKey === accountKey(this.snapshot) && payload.confirmation === a.login, "账户已变化，请重新核对账号", 409);
          requireValue(a.tradeAllowed, "请在 MT4 开启自动交易并允许 EA 交易", 409);
          requireValue(a.mode === "demo" || (a.mode === "real" && a.allowReal && payload.acceptReal === true), "实盘交易需要在 MT4 和本页分别确认开启", 409);
          requireValue(!this.state.commands.some(c => ACTIVE.has(c.status)), "请先核对未完成的命令", 409);
          this.enabled = true; break;
        }
        case "pause": this.stop("交易已暂停"); break;
        case "command": this.submit(payload.command); break;
        case "resolve": {
          const c = this.state.commands.find(c => c.id === payload.id);
          requireValue(c?.status === "unknown" && payload.confirmation === c.login, "请先核对该命令对应的 MT4 账号和交易记录", 409);
          c.status = "resolved"; c.error = "用户已在 MT4 核对；该命令不会再次发送"; break;
        }
        default: throw new Mt4Error("不支持的 MT4 操作");
      }
      return this.status();
    });
  }
  submit(input) {
    requireValue(input && ID.test(input.id), "命令标识无效");
    const c = { id: input.id, accountKey: text(input.accountKey, "账户标识", 64), type: input.type,
      symbol: input.symbol, side: input.side ?? "buy", orderType: input.orderType ?? "market",
      lots: number(input.lots ?? 0, "手数", 0, 100000), price: number(input.price ?? 0, "委托价格", 0),
      stopLoss: number(input.stopLoss ?? 0, "止损", 0), takeProfit: number(input.takeProfit ?? 0, "止盈", 0),
      slippage: number(input.slippage ?? 20, "允许滑点", 0, 1000), ticket: number(input.ticket ?? 0, "订单号", 0, 2147483647) };
    if (input.sizingMode === "risk-percent") Object.assign(c, { sizingMode: "risk-percent", riskPercent: number(input.riskPercent, "单笔风险比例", 0.0001, 100) });
    else requireValue(input.sizingMode == null || input.sizingMode === "fixed", "下单方式无效");
    if (input.gapMode != null && input.gapMode !== "off") {
      requireValue(["high", "low"].includes(input.gapMode) && ["price", "percent"].includes(input.gapUnit), "跳空过滤设置无效");
      Object.assign(c, { gapMode: input.gapMode, gapUnit: input.gapUnit, gapThreshold: number(input.gapThreshold, "跳空阈值", 0.0001), gapTimeframe: number(input.gapTimeframe, "过滤周期", 1, 43200), gapBarTime: number(input.gapBarTime, "过滤 K 线时间", 1) });
    }
    requireValue(["open", "close", "cancel", "protect"].includes(c.type) && typeof c.symbol === "string" && SYMBOL.test(c.symbol) &&
      ["buy", "sell"].includes(c.side) && ["market", "limit", "stop"].includes(c.orderType) && Number.isInteger(c.slippage) && Number.isInteger(c.ticket), "交易指令无效");
    const serialized = JSON.stringify(c); const old = this.state.commands.find(item => item.id === c.id);
    if (old) { requireValue(old.serialized === serialized, "命令标识重复且内容不同", 409); return; }
    requireValue(!(c.sizingMode || c.gapMode) || c.type === "open", "风险手数和跳空过滤仅适用于开仓");
    requireValue(this.enabled && this.status().connection === "connected", "请先连接并开启 MT4 交易", 409);
    requireValue(c.accountKey === accountKey(this.snapshot), "账户已变化，请重新读取", 409);
    requireValue(!this.state.commands.some(item => ACTIVE.has(item.status)), "已有未完成的命令，请先等待或核对", 409);
    const a = this.snapshot.account;
    requireValue(a.tradeAllowed && (a.mode === "demo" || (a.mode === "real" && a.allowReal)), "MT4 交易权限已关闭", 409);
    const s = this.snapshot.symbols.find(s => s.symbol === c.symbol);
    requireValue(s && s.tradeAllowed, "该品种当前不可交易", 409);
    requireValue(s.bid > 0 && s.ask > 0 && this.now() / 1000 - s.quoteTime <= 30 && s.quoteTime <= this.now() / 1000 + 10, "报价已过期，请等待 MT4 更新后重试", 409);
    if (c.type === "open") {
      if (c.sizingMode || c.gapMode) requireValue(this.snapshot.executionVersion >= 2, "请先更新连接 EA 或加载合并版面板，再使用风险手数和跳空过滤", 409);
      if (c.sizingMode === "risk-percent") {
        try { c.lots = riskSizedMt4Lots({ balance: a.balance, riskPercent: c.riskPercent, entryPrice: c.orderType === "market" ? c.side === "buy" ? s.ask : s.bid : c.price, stopLoss: c.stopLoss, symbol: s }).lots; }
        catch (e) { throw new Mt4Error(e.message); }
      }
      if (c.gapMode) {
        const chart = this.snapshot.chart, bar = chart.bars.at(-1), previous = chart.bars.at(-2);
        requireValue(c.side === "buy" && c.orderType === "market" && chart.symbol === c.symbol && chart.timeframe === c.gapTimeframe && bar?.timestamp === c.gapBarTime, "跳空过滤仅用于当前图表的市价买入，请重新读取后设置");
        try { checkMt4OpeningGap({ previousClose: previous?.close, openingPrice: bar?.open, mode: c.gapMode, unit: c.gapUnit, threshold: c.gapThreshold }); }
        catch (e) { throw new Mt4Error(e.message); }
      }
      requireValue(c.lots >= s.minLot && c.lots <= s.maxLot && s.lotStep > 0 && Math.abs(c.lots / s.lotStep - Math.round(c.lots / s.lotStep)) < 1e-7, "手数不符合该品种的最小值或步长");
      const distance = s.stopLevel * s.point;
      if (c.orderType !== "market") {
        requireValue(c.price > 0 && (c.side === "buy" ? c.orderType === "limit" ? c.price <= s.ask - distance : c.price >= s.ask + distance : c.orderType === "limit" ? c.price >= s.bid + distance : c.price <= s.bid - distance), "挂单价格不符合方向或最小距离");
      }
      const reference = c.orderType === "market" ? c.side === "buy" ? s.bid : s.ask : c.price;
      this.validateProtection(c, c.side, reference, distance);
    } else {
      const order = this.snapshot.orders.find(o => o.ticket === c.ticket && o.symbol === c.symbol);
      requireValue(order && (c.type === "cancel" ? order.type >= 2 : c.type === "close" ? order.type < 2 : true), "该订单已变化，请重新读取 MT4", 409);
      if (c.type === "protect") this.validateProtection(c, order.type % 2 === 0 ? "buy" : "sell", order.type < 2 ? order.type === 0 ? s.bid : s.ask : order.openPrice, s.stopLevel * s.point);
    }
    for (const price of [c.price, c.stopLoss, c.takeProfit]) {
      requireValue(Math.abs(price / s.point - Math.round(price / s.point)) < 1e-5, "价格精度不符合该品种报价");
      if (s.tickSize > 0) requireValue(Math.abs(price / s.tickSize - Math.round(price / s.tickSize)) < 1e-5, "价格不符合该品种的最小跳动单位");
    }
    this.state.commands.push({ ...c, serialized, login: a.login, server: a.server, mode: a.mode, sessionId: this.snapshot.sessionId,
      status: "queued", createdAt: this.now(), expiresAt: this.now() + 15000, ticket: c.ticket, error: "" });
  }
  validateProtection(c, side, reference, distance) {
    requireValue(!c.stopLoss || (side === "buy" ? reference - c.stopLoss : c.stopLoss - reference) >= Math.max(distance, 1e-10), "止损方向或距离不符合品种规则");
    requireValue(!c.takeProfit || (side === "buy" ? c.takeProfit - reference : reference - c.takeProfit) >= Math.max(distance, 1e-10), "止盈方向或距离不符合品种规则");
  }
  async terminal(token, payload, { fast = false } = {}) {
    const supplied = Buffer.from(String(token ?? "")); const expected = Buffer.from(this.state.token);
    requireValue(expected.length > 0 && supplied.length === expected.length && timingSafeEqual(supplied, expected), "MT4 配对凭证无效", 401);
    let next = normalizeMt4Snapshot(payload);
    next.archiveVersion = payload.archiveVersion === 1 ? 1 : 0;
    requireValue(Math.abs(this.now() / 1000 - next.capturedAt) <= 60, "电脑与终端时间不一致，请检查系统时间", 409);
    return this.run(() => {
      requireValue(token === this.state.token, "MT4 配对凭证已变化", 401);
      if (fast) {
        requireValue(payload.commandPollVersion === 1 && this.snapshot?.commandPollVersion === 1 && accountKey(next) === accountKey(this.snapshot) && next.sessionId === this.snapshot.sessionId, "请先重新建立当前终端连接", 409);
        requireValue(next.capturedAt >= this.snapshot.capturedAt, "终端数据已过期，请重新读取", 409);
        const hot = new Set(next.symbols.map(symbol => symbol.symbol));
        let chart = this.snapshot.chart;
        if (next.marketPollVersion === 1) {
          requireValue(next.chart.bars.length <= 2, "快速 K 线数据无效");
          const tail = next.chart.bars, base = chart.bars, last = base.at(-1);
          if (tail.length && last && chart.symbol === next.chart.symbol && chart.timeframe === next.chart.timeframe && chart.symbol === this.state.selection.symbol && chart.timeframe === this.state.selection.timeframe && tail.at(-1).timestamp >= last.timestamp && tail.some(bar => bar.timestamp === last.timestamp)) {
            const byTime = new Map(base.map(bar => [bar.timestamp, bar]));
            const floor = base.at(-2)?.timestamp ?? last.timestamp;
            for (const bar of tail) if (bar.timestamp >= floor) byTime.set(bar.timestamp, bar);
            chart = { ...chart, bars: [...byTime.values()].sort((a,b) => a.timestamp - b.timestamp).slice(-300) };
          }
        }
        next = { ...next, symbols: [...next.symbols, ...this.snapshot.symbols.filter(symbol => !hot.has(symbol.symbol))].slice(0, 300), chart, archiveVersion: this.snapshot.archiveVersion };
      }
      this.expire();
      const fresh = this.snapshot && this.now() - this.lastSeen <= 15000;
      requireValue(!fresh || next.sessionId === this.snapshot.sessionId, "另一个 MT4 连接正在使用该配对，请只挂载一次 EA", 409);
      if (this.snapshot && (accountKey(next) !== accountKey(this.snapshot) || next.sessionId !== this.snapshot.sessionId)) this.stop("账户或终端已切换");
      if (!next.account.connected || !next.account.tradeAllowed || (next.account.mode === "real" && !next.account.allowReal)) this.stop("MT4 交易权限或连接已关闭");
      this.snapshot = next; this.lastSeen = this.now();
      if (!fast || next.receipts.length) this.collectArchive(next, fast ? { ...payload, archiveResponse: null } : payload);
      const ack = [];
      for (const receipt of next.receipts) {
        const c = this.state.commands.find(c => c.id === receipt.id);
        if (!c) continue;
        if (c.accountKey !== accountKey(next)) { ack.push(c.id); continue; }
        if (["succeeded", "failed"].includes(c.status)) { ack.push(c.id); continue; }
        if (!["sent", "unknown", "resolved"].includes(c.status)) continue;
        if (c.status === "resolved" && receipt.status === "unknown") { ack.push(c.id); continue; }
        c.status = receipt.status; c.ticket = receipt.ticket; c.rawError = receipt.error; c.error = receiptError(receipt); c.updatedAt = this.now(); ack.push(c.id);
        if (receipt.status === "unknown") this.enabled = false;
      }
      const c = this.enabled ? this.state.commands.find(c => c.status === "queued" || (c.status === "sent" && this.now() <= c.expiresAt)) : null;
      if (c && (c.sizingMode || c.gapMode) && next.executionVersion < 2) { c.status = "failed"; c.error = "连接 EA 版本已变化，指令未发送；请更新 EA 后重试"; }
      let wire = "";
      if (c && (c.status === "queued" || (c.status === "sent" && this.now() - (this.dispatchTimes.get(c.id) ?? 0) >= 200))) {
        requireValue(c.accountKey === accountKey(next) && c.sessionId === next.sessionId, "账户或终端发生变化", 409);
        c.status = "sent"; c.sentAt ??= this.now(); this.dispatchTimes.set(c.id, this.now());
        wire = [c.id, c.login, Buffer.from(c.server).toString("hex"), c.mode, c.sessionId, Math.floor(c.expiresAt / 1000),
          c.type, c.symbol, c.side, c.orderType, c.lots, c.price, c.stopLoss, c.takeProfit, c.slippage, c.ticket].join("|");
        if (c.sizingMode || c.gapMode) wire += "|" + [c.sizingMode ?? "fixed", c.riskPercent ?? 0, c.gapMode ?? "off", c.gapUnit ?? "percent", c.gapThreshold ?? 0, c.gapTimeframe ?? 0, Math.floor((c.gapBarTime ?? 0) / 1000)].join("|");
      }
      if (!next.symbols.some(s => s.symbol === this.state.selection.symbol)) this.state.selection.symbol = next.symbols.some(s => s.symbol === next.chart.symbol) ? next.chart.symbol : next.symbols[0]?.symbol ?? "";
      return { protocolVersion: 1, wire, symbol: this.state.selection.symbol, timeframe: this.state.selection.timeframe, ack: ack.join(","), fastPollMs: next.commandPollVersion === 1 ? 200 : 0, archiveWire: fast ? "" : this.archiveWire(next) };
    });
  }
  collectArchive(next, payload) {
    try {
      const key = accountKey(next), total = payload.archiveVersion === 1 ? number(payload.historyTotal, "历史数量", 0, 10000000) : 0;
      if (next.archiveVersion && (!this.archiveScan || this.archiveScan.accountKey !== key || this.archiveScan.sessionId !== next.sessionId || this.archiveScan.total !== total)) {
        this.archiveScan = { accountKey: key, sessionId: next.sessionId, total, offset: 0, complete: total === 0, updatedAt: this.now() }; this.archiveJob = null;
      }
      let page = null;
      const reply = payload.archiveResponse, job = this.archiveJob;
      if (reply && job && reply.id === job.id && job.accountKey === key && job.sessionId === next.sessionId) {
        if (job.kind === 'h') {
          requireValue(reply.kind === 'h' && reply.offset === job.offset && reply.total === total && reply.next === Math.min(total, job.offset + 50), "历史分页已变化，请重新同步");
          requireValue(reply.ok === true, "MT4 历史读取未完成，请在终端选择全部历史后重试");
          page = list(reply.orders, 50, "历史分页").map(normalizeOrder);
          requireValue(page.every(o => o.closeTime > 0), "历史分页包含未结束订单");
          // Commit the cursor only together with its rows.
          const scan = { ...this.archiveScan, offset: reply.next, complete: reply.next >= total, updatedAt: this.now() };
          this.archive.ingest(next, { historyPage: page, scan }); this.archiveScan = scan;
        } else {
          requireValue(reply.kind === 'b', "历史行情回报无效");
          const normalized = normalizeMt4Snapshot({ ...next, chart: { symbol: job.symbol, timeframe: job.timeframe, bars: reply.bars } });
          this.archive.saveBars(key, job.symbol, job.timeframe, normalized.chart.bars);
          const covered = reply.ok && normalized.chart.bars.some(bar => bar.timestamp <= job.anchor * 1000 && job.anchor * 1000 < mt4PeriodEnd(bar.timestamp, job.timeframe));
          this.archive.finishMarketRequest(key, job.symbol, job.timeframe, job.anchor, covered ? 'complete' : 'missing');
          if (this.chartJob?.id === job.id) this.chartJob = { ...job, status: covered ? 'complete' : 'missing', error: covered ? '' : '终端暂未提供该时段行情，请稍后补取' };
        }
        this.archiveJob = null;
      }
      if (!page) this.archive.ingest(next, { scan: this.archiveScan?.accountKey === key ? this.archiveScan : null });
      this.archiveError = "";
    } catch (error) { this.archiveError = error instanceof Mt4Error ? error.message : "历史档案未保存，请检查本机存储后重试同步"; }
  }
  archiveWire(next) {
    try {
    if (!next.archiveVersion || this.archiveError) return '';
    const key = accountKey(next);
    if (this.archiveJob && (this.archiveJob.accountKey !== key || this.archiveJob.sessionId !== next.sessionId)) this.archiveJob = null;
    if (this.archiveJob && this.now() - this.archiveJob.createdAt > 60000) {
      if (this.archiveJob.kind === 'b' && this.chartJob?.id === this.archiveJob.id) this.chartJob = { ...this.archiveJob, status: 'missing', error: '历史行情读取超时，请重新补取' };
      if (this.archiveJob.kind === 'b') this.archive.finishMarketRequest(key, this.archiveJob.symbol, this.archiveJob.timeframe, this.archiveJob.anchor, 'missing');
      this.archiveJob = null;
    }
    if (!this.archiveJob && this.chartJob?.status === 'queued' && this.chartJob.accountKey === key) this.archiveJob = { ...this.chartJob, sessionId: next.sessionId, createdAt: this.now() };
    if (!this.archiveJob && this.archiveScan?.accountKey === key && !this.archiveScan.complete) this.archiveJob = { id: randomUUID(), kind: 'h', accountKey: key, sessionId: next.sessionId, offset: this.archiveScan.offset, total: this.archiveScan.total, createdAt: this.now() };
    if (!this.archiveJob) {
      const pending = this.archive.nextMarketRequest(key);
      if (pending) this.archiveJob = { ...pending, id: randomUUID(), kind: 'b', accountKey: key, sessionId: next.sessionId, createdAt: this.now() };
    }
    const job = this.archiveJob; if (!job) return '';
    return [job.id, job.kind, next.account.login, Buffer.from(next.account.server).toString('hex'), next.account.mode, next.sessionId,
      ...(job.kind === 'h' ? [job.offset, job.total] : [Buffer.from(job.symbol).toString('hex'), job.timeframe, job.anchor])].join('|');
    } catch { this.archiveError = '历史行情任务未能读取，请检查本机存储后重试同步'; return ''; }
  }
  archiveRequest(payload) {
    if (payload.action === 'save-analysis') return this.archive.saveAnalysis(payload);
    if (payload.action === 'restore') return this.archive.restore(payload.backup);
    requireValue(this.snapshot && payload.accountKey === accountKey(this.snapshot) && this.status().connection === 'connected', '请连接这份档案所属的 MT4 账户后重试', 409);
    requireValue(this.snapshot.archiveVersion === 1, '请下载并重新挂载支持历史归档的连接 EA 或面板合并版', 409);
    if (payload.action === 'rescan') { this.archive.retryMarketRequests(payload.accountKey); this.archiveScan = null; this.archiveJob = null; this.archiveError = ''; return { queued: true }; }
    requireValue(payload.action === 'chart' && typeof payload.symbol === 'string' && SYMBOL.test(payload.symbol) && [1,5,15,30,60,240,1440,10080,43200].includes(payload.timeframe) && Number.isFinite(payload.anchor) && payload.anchor > 0, '历史行情范围无效');
    this.archive.trade(payload.accountKey, payload.symbol, payload.ticket, payload.timeframe);
    this.chartJob = { id: randomUUID(), kind: 'b', accountKey: payload.accountKey, symbol: payload.symbol, timeframe: payload.timeframe, anchor: Math.floor(payload.anchor), status: 'queued', createdAt: this.now() };
    return { queued: true, id: this.chartJob.id };
  }
}
