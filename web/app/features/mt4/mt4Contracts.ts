export type Mt4Symbol = {
  symbol: string; digits: number; point: number; bid: number; ask: number; quoteTime: number;
  minLot: number; maxLot: number; lotStep: number; contractSize: number; tickValue: number; tickSize: number;
  stopLevel: number; freezeLevel: number; tradeAllowed: boolean;
};
export type Mt4Order = {
  ticket: number; symbol: string; type: number; lots: number; openPrice: number; stopLoss: number; takeProfit: number;
  profit: number; swap: number; commission: number; openTime: number; closeTime: number; closePrice: number; magic: number; comment?: string;
};
export type Mt4CommandInput = {
  id: string; accountKey: string; type: "open" | "close" | "cancel" | "protect"; symbol: string;
  side?: "buy" | "sell"; orderType?: "market" | "limit" | "stop"; lots?: number; price?: number;
  stopLoss?: number; takeProfit?: number; slippage?: number; ticket?: number;
  sizingMode?: "fixed" | "risk-percent"; riskPercent?: number;
  gapMode?: "off" | "high" | "low"; gapUnit?: "price" | "percent"; gapThreshold?: number; gapTimeframe?: number; gapBarTime?: number;
};
export type Mt4Command = Mt4CommandInput & {
  login: string; server: string; mode: string; status: "queued" | "sent" | "unknown" | "succeeded" | "failed" | "cancelled" | "resolved";
  createdAt: number; expiresAt: number; ticket: number; error: string;
};
export type Mt4Status = {
  protocolVersion: number; paired: boolean; enabled: boolean; connection: "unpaired" | "waiting" | "connected" | "offline";
  lastSeen: number; accountKey: string; unresolved: number; transportError?: string; selection: { symbol: string; timeframe: number }; commands: Mt4Command[];
  archive?: { version: number; terminalVersion: number; error: string; scan: { accountKey: string; total: number; offset: number; complete: boolean } | null; chartJob: { id: string; status: string; error?: string } | null };
  snapshot: null | {
    executionVersion?: number; commandPollVersion?: number; marketPollVersion?: number; sessionId: string; capturedAt: number; serverUtcOffset?: number;
    account: { login: string; server: string; mode: "demo" | "real" | "contest"; currency: string; balance: number; equity: number;
      margin: number; freeMargin: number; profit: number; connected: boolean; tradeAllowed: boolean; allowReal: boolean };
    symbols: Mt4Symbol[]; orderCount: number; orders: Mt4Order[]; history: Mt4Order[];
    chart: { symbol: string; timeframe: number; bars: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[] };
  };
};
