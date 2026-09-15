const MAX_LIVE_ITEMS = 500;
const MAX_LIVE_JSON_BYTES = 512 * 1024;

type JsonRecord = Record<string, unknown>;

type NormalizedPosition = {
  id: string;
  side: "long" | "short";
  qty: number;
  entryPrice: number;
  entryTimestamp: number;
  entryOrderId: string;
  status: "open" | "closed";
  exitPrice: number | null;
  exitTimestamp: number | null;
  exitOrderId: string | null;
  realizedPnl: number | null;
};

type NormalizedPendingOrder = {
  id: string;
  action: "open" | "close";
  side: "buy" | "sell";
  qty: number;
  createdAt: number;
  positionId: string;
  ruleId: string | null;
  ruleVersion: string | null;
  priceBand: unknown | null;
  reservedCash: number | null;
  executeAtTimestamp: number | null;
};

type NormalizedExecution = {
  id: string;
  orderId: string;
  positionId: string;
  action: "open" | "close";
  side: "buy" | "sell";
  qty: number;
  price: number;
  timestamp: number;
  realizedPnl: number;
  ruleId: string | null;
  ruleVersion: string | null;
};

type NormalizedOrderRejection = {
  id: string;
  orderId: string | null;
  code: string;
  message: string;
  timestamp: number;
  ruleId: string;
  ruleVersion: string;
};

export type NormalizedPortfolio = {
  instrumentId: string;
  symbol: string;
  name: string;
  market: "CN" | "US";
  latestTimestamp: number;
  latestClose: number;
  scanTimestamp: number;
  presetIds: string[];
  presetNames: string[];
  positions: NormalizedPosition[];
  pendingOrders: NormalizedPendingOrder[];
  executions: NormalizedExecution[];
  orderRejections: NormalizedOrderRejection[];
  tradingMode: "return" | "capital";
  initialCapital: number;
  cashBalance: number;
  decision: JsonRecord | null;
  decisionSubmissions: unknown[];
  updatedAt: string;
  sortOrder: number;
};

export type NormalizedWatch = {
  instrumentId: string;
  symbol: string;
  name: string;
  market: "CN" | "US" | "FX" | "GOLD";
  latestTimestamp: number;
  latestClose: number;
  observationTimestamp: number | null;
  observationClose: number | null;
  entryTimestamp: number | null;
  entryPrice: number | null;
  scanTimestamp: number;
  presetIds: string[];
  presetNames: string[];
  updatedAt: string;
  sortOrder: number;
};

type DeleteRequest = {
  instrumentId: string;
  updatedAt: string | null;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown, limit = 500) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, limit);
}

function jsonText(value: unknown, fallback: unknown) {
  try {
    const serialized = JSON.stringify(value ?? fallback);
    if (typeof serialized === "string"
      && new TextEncoder().encode(serialized).byteLength <= MAX_LIVE_JSON_BYTES) {
      return serialized;
    }
  } catch {
    // Fall through to the bounded fallback.
  }
  return JSON.stringify(fallback);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizePosition(value: unknown): NormalizedPosition | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const side = value.side === "long" || value.side === "short" ? value.side : null;
  const status = value.status === "open" || value.status === "closed" ? value.status : null;
  const qty = finiteNumber(value.qty);
  const entryPrice = finiteNumber(value.entryPrice);
  const entryTimestamp = finiteNumber(value.entryTimestamp);
  const entryOrderId = stringValue(value.entryOrderId);
  if (!id || !side || !status || qty <= 0 || entryPrice <= 0 || !entryOrderId) return null;
  const exitPrice = nullableNumber(value.exitPrice);
  const exitTimestamp = nullableNumber(value.exitTimestamp);
  if (status === "closed" && (exitPrice === null || exitTimestamp === null)) return null;
  return {
    id,
    side,
    qty,
    entryPrice,
    entryTimestamp,
    entryOrderId,
    status,
    exitPrice,
    exitTimestamp,
    exitOrderId: stringValue(value.exitOrderId) || null,
    realizedPnl: nullableNumber(value.realizedPnl),
  };
}

function normalizePendingOrder(value: unknown): NormalizedPendingOrder | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const action = value.action === "open" || value.action === "close" ? value.action : null;
  const side = value.side === "buy" || value.side === "sell" ? value.side : null;
  const qty = finiteNumber(value.qty);
  const createdAt = finiteNumber(value.createdAt);
  const positionId = stringValue(value.positionId);
  if (!id || !action || !side || qty <= 0 || !positionId) return null;
  return {
    id,
    action,
    side,
    qty,
    createdAt,
    positionId,
    ruleId: stringValue(value.ruleId) || null,
    ruleVersion: stringValue(value.ruleVersion) || null,
    priceBand: isRecord(value.priceBand) ? value.priceBand : null,
    reservedCash: nullableNumber(value.reservedCash),
    executeAtTimestamp: nullableNumber(value.executeAtTimestamp),
  };
}

function normalizeExecution(value: unknown): NormalizedExecution | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const orderId = stringValue(value.orderId);
  const positionId = stringValue(value.positionId);
  const action = value.action === "open" || value.action === "close" ? value.action : null;
  const side = value.side === "buy" || value.side === "sell" ? value.side : null;
  const qty = finiteNumber(value.qty);
  const price = finiteNumber(value.price);
  const timestamp = finiteNumber(value.timestamp);
  const realizedPnl = finiteNumber(value.realizedPnl);
  if (!id || !orderId || !positionId || !action || !side || qty <= 0 || price <= 0) return null;
  return {
    id,
    orderId,
    positionId,
    action,
    side,
    qty,
    price,
    timestamp,
    realizedPnl,
    ruleId: stringValue(value.ruleId) || null,
    ruleVersion: stringValue(value.ruleVersion) || null,
  };
}

function normalizeOrderRejection(value: unknown): NormalizedOrderRejection | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const code = stringValue(value.code);
  const message = stringValue(value.message);
  const ruleId = stringValue(value.ruleId);
  const ruleVersion = stringValue(value.ruleVersion);
  if (!id || !code || !message || !ruleId || !ruleVersion) return null;
  return {
    id,
    orderId: stringValue(value.orderId) || null,
    code,
    message,
    timestamp: finiteNumber(value.timestamp),
    ruleId,
    ruleVersion,
  };
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function normalizePortfolio(value: unknown, sortOrder = 0): NormalizedPortfolio | null {
  if (!isRecord(value)) return null;
  const instrumentId = stringValue(value.instrumentId);
  const market = value.market === "CN" || value.market === "US" ? value.market : null;
  const symbol = stringValue(value.symbol, instrumentId);
  const name = stringValue(value.name, symbol);
  const updatedAt = stringValue(value.updatedAt, new Date(0).toISOString());
  if (!instrumentId || !market || !symbol || !name) return null;
  const positions = uniqueById(
    (Array.isArray(value.positions) ? value.positions : [])
      .map(normalizePosition)
      .filter((item): item is NormalizedPosition => Boolean(item)),
  );
  const pendingOrders = uniqueById(
    (Array.isArray(value.pendingOrders) ? value.pendingOrders : [])
      .map(normalizePendingOrder)
      .filter((item): item is NormalizedPendingOrder => Boolean(item)),
  );
  const executions = uniqueById(
    (Array.isArray(value.executions) ? value.executions : [])
      .map(normalizeExecution)
      .filter((item): item is NormalizedExecution => Boolean(item)),
  );
  const orderRejections = uniqueById(
    (Array.isArray(value.orderRejections) ? value.orderRejections : [])
      .map(normalizeOrderRejection)
      .filter((item): item is NormalizedOrderRejection => Boolean(item)),
  );
  return {
    instrumentId,
    symbol,
    name,
    market,
    latestTimestamp: finiteNumber(value.latestTimestamp),
    latestClose: finiteNumber(value.latestClose),
    scanTimestamp: finiteNumber(value.scanTimestamp),
    presetIds: stringArray(value.presetIds),
    presetNames: stringArray(value.presetNames),
    positions,
    pendingOrders,
    executions,
    orderRejections,
    tradingMode: value.tradingMode === "capital" ? "capital" : "return",
    initialCapital: finiteNumber(value.initialCapital),
    cashBalance: finiteNumber(value.cashBalance),
    decision: isRecord(value.decision) ? value.decision : null,
    decisionSubmissions: Array.isArray(value.decisionSubmissions)
      ? value.decisionSubmissions.slice(0, 500)
      : [],
    updatedAt,
    sortOrder: Number.isFinite(value.sortOrder) ? Math.round(Number(value.sortOrder)) : sortOrder,
  };
}

export function normalizeWatch(value: unknown, sortOrder = 0): NormalizedWatch | null {
  if (!isRecord(value)) return null;
  const instrumentId = stringValue(value.instrumentId);
  const market = value.market === "CN" || value.market === "US" || value.market === "FX" || value.market === "GOLD"
    ? value.market
    : null;
  const symbol = stringValue(value.symbol, instrumentId);
  const name = stringValue(value.name, symbol);
  const updatedAt = stringValue(value.updatedAt, new Date(0).toISOString());
  if (!instrumentId || !market || !symbol || !name) return null;
  return {
    instrumentId,
    symbol,
    name,
    market,
    latestTimestamp: finiteNumber(value.latestTimestamp),
    latestClose: finiteNumber(value.latestClose),
    observationTimestamp: nullableNumber(value.observationTimestamp),
    observationClose: nullableNumber(value.observationClose),
    entryTimestamp: nullableNumber(value.entryTimestamp),
    entryPrice: nullableNumber(value.entryPrice),
    scanTimestamp: finiteNumber(value.scanTimestamp),
    presetIds: stringArray(value.presetIds),
    presetNames: stringArray(value.presetNames),
    updatedAt,
    sortOrder: Number.isFinite(value.sortOrder) ? Math.round(Number(value.sortOrder)) : sortOrder,
  };
}

function normalizeDeletes(value: unknown): DeleteRequest[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    const record = typeof item === "string"
      ? { instrumentId: item, updatedAt: null }
      : isRecord(item)
        ? { instrumentId: stringValue(item.instrumentId), updatedAt: stringValue(item.updatedAt) || null }
        : null;
    if (!record?.instrumentId || seen.has(record.instrumentId)) return [];
    seen.add(record.instrumentId);
    return [record];
  }).slice(0, MAX_LIVE_ITEMS);
}

function bindNullableNumber(value: number | null) {
  return value;
}

function portfolioUpsertStatement(db: D1Database, portfolio: NormalizedPortfolio, force = false) {
  const conflict = force
    ? `ON CONFLICT(instrument_id) DO UPDATE SET
        symbol = excluded.symbol, name = excluded.name, market = excluded.market,
        latest_timestamp = excluded.latest_timestamp, latest_close = excluded.latest_close,
        scan_timestamp = excluded.scan_timestamp, preset_ids_json = excluded.preset_ids_json,
        preset_names_json = excluded.preset_names_json, decision_json = excluded.decision_json,
        decision_submissions_json = excluded.decision_submissions_json,
        trading_mode = excluded.trading_mode, initial_capital = excluded.initial_capital,
        cash_balance = excluded.cash_balance, updated_at = excluded.updated_at,
        sort_order = excluded.sort_order`
    : `ON CONFLICT(instrument_id) DO UPDATE SET
        symbol = excluded.symbol, name = excluded.name, market = excluded.market,
        latest_timestamp = excluded.latest_timestamp, latest_close = excluded.latest_close,
        scan_timestamp = excluded.scan_timestamp, preset_ids_json = excluded.preset_ids_json,
        preset_names_json = excluded.preset_names_json, decision_json = excluded.decision_json,
        decision_submissions_json = excluded.decision_submissions_json,
        trading_mode = excluded.trading_mode, initial_capital = excluded.initial_capital,
        cash_balance = excluded.cash_balance, updated_at = excluded.updated_at,
        sort_order = excluded.sort_order
      WHERE excluded.updated_at >= live_portfolios.updated_at`;
  return db.prepare(`INSERT INTO live_portfolios
      (instrument_id, symbol, name, market, latest_timestamp, latest_close,
       scan_timestamp, preset_ids_json, preset_names_json, decision_json,
       decision_submissions_json, trading_mode, initial_capital, cash_balance,
       updated_at, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${conflict}`)
    .bind(
      portfolio.instrumentId,
      portfolio.symbol,
      portfolio.name,
      portfolio.market,
      portfolio.latestTimestamp,
      portfolio.latestClose,
      portfolio.scanTimestamp,
      JSON.stringify(portfolio.presetIds),
      JSON.stringify(portfolio.presetNames),
      portfolio.decision ? jsonText(portfolio.decision, null) : null,
      jsonText(portfolio.decisionSubmissions, []),
      portfolio.tradingMode,
      portfolio.initialCapital,
      portfolio.cashBalance,
      portfolio.updatedAt,
      portfolio.sortOrder,
    );
}

function watchUpsertStatement(db: D1Database, watch: NormalizedWatch, force = false) {
  const conflict = force
    ? `ON CONFLICT(instrument_id) DO UPDATE SET
        symbol = excluded.symbol, name = excluded.name, market = excluded.market,
        latest_timestamp = excluded.latest_timestamp, latest_close = excluded.latest_close,
        observation_timestamp = excluded.observation_timestamp, observation_close = excluded.observation_close,
        entry_timestamp = excluded.entry_timestamp, entry_price = excluded.entry_price,
        scan_timestamp = excluded.scan_timestamp, preset_ids_json = excluded.preset_ids_json,
        preset_names_json = excluded.preset_names_json, updated_at = excluded.updated_at,
        sort_order = excluded.sort_order`
    : `ON CONFLICT(instrument_id) DO UPDATE SET
        symbol = excluded.symbol, name = excluded.name, market = excluded.market,
        latest_timestamp = excluded.latest_timestamp, latest_close = excluded.latest_close,
        observation_timestamp = excluded.observation_timestamp, observation_close = excluded.observation_close,
        entry_timestamp = excluded.entry_timestamp, entry_price = excluded.entry_price,
        scan_timestamp = excluded.scan_timestamp, preset_ids_json = excluded.preset_ids_json,
        preset_names_json = excluded.preset_names_json, updated_at = excluded.updated_at,
        sort_order = excluded.sort_order
      WHERE excluded.updated_at >= live_watchlist.updated_at`;
  return db.prepare(`INSERT INTO live_watchlist
      (instrument_id, symbol, name, market, latest_timestamp, latest_close,
       observation_timestamp, observation_close, entry_timestamp, entry_price,
       scan_timestamp, preset_ids_json, preset_names_json, updated_at, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${conflict}`)
    .bind(
      watch.instrumentId,
      watch.symbol,
      watch.name,
      watch.market,
      watch.latestTimestamp,
      watch.latestClose,
      bindNullableNumber(watch.observationTimestamp),
      bindNullableNumber(watch.observationClose),
      bindNullableNumber(watch.entryTimestamp),
      bindNullableNumber(watch.entryPrice),
      watch.scanTimestamp,
      JSON.stringify(watch.presetIds),
      JSON.stringify(watch.presetNames),
      watch.updatedAt,
      watch.sortOrder,
    );
}

function childStatements(db: D1Database, portfolio: NormalizedPortfolio) {
  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM live_positions WHERE portfolio_instrument_id = ?").bind(portfolio.instrumentId),
    db.prepare("DELETE FROM live_pending_orders WHERE portfolio_instrument_id = ?").bind(portfolio.instrumentId),
    db.prepare("DELETE FROM live_executions WHERE portfolio_instrument_id = ?").bind(portfolio.instrumentId),
    db.prepare("DELETE FROM live_order_rejections WHERE portfolio_instrument_id = ?").bind(portfolio.instrumentId),
  ];
  for (const position of portfolio.positions) {
    statements.push(db.prepare(`INSERT INTO live_positions
      (id, portfolio_instrument_id, side, qty, entry_price, entry_timestamp,
       entry_order_id, status, exit_price, exit_timestamp, exit_order_id, realized_pnl)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(position.id, portfolio.instrumentId, position.side, position.qty, position.entryPrice,
        position.entryTimestamp, position.entryOrderId, position.status, position.exitPrice,
        position.exitTimestamp, position.exitOrderId, position.realizedPnl));
  }
  for (const order of portfolio.pendingOrders) {
    statements.push(db.prepare(`INSERT INTO live_pending_orders
      (id, portfolio_instrument_id, action, side, qty, created_at, position_id,
       rule_id, rule_version, price_band_json, reserved_cash, execute_at_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(order.id, portfolio.instrumentId, order.action, order.side, order.qty, order.createdAt,
        order.positionId, order.ruleId, order.ruleVersion,
        order.priceBand ? jsonText(order.priceBand, null) : null, order.reservedCash,
        order.executeAtTimestamp));
  }
  for (const execution of portfolio.executions) {
    statements.push(db.prepare(`INSERT INTO live_executions
      (id, portfolio_instrument_id, order_id, position_id, action, side, qty,
       price, timestamp, realized_pnl, rule_id, rule_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(execution.id, portfolio.instrumentId, execution.orderId, execution.positionId,
        execution.action, execution.side, execution.qty, execution.price, execution.timestamp,
        execution.realizedPnl, execution.ruleId, execution.ruleVersion));
  }
  for (const rejection of portfolio.orderRejections) {
    statements.push(db.prepare(`INSERT INTO live_order_rejections
      (id, portfolio_instrument_id, order_id, code, message, timestamp, rule_id, rule_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(rejection.id, portfolio.instrumentId, rejection.orderId, rejection.code,
        rejection.message, rejection.timestamp, rejection.ruleId, rejection.ruleVersion));
  }
  return statements;
}

async function runInChunks(db: D1Database, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 80) {
    const chunk = statements.slice(index, index + 80);
    if (chunk.length) await db.batch(chunk);
  }
}

export async function migrateLegacyLiveData(db: D1Database) {
  const marker = await db
    .prepare("SELECT value FROM app_metadata WHERE key = 'live_data_migrated_v1'")
    .first<{ value: string }>();
  if (marker) return;
  const row = await db
    .prepare("SELECT value FROM app_metadata WHERE key = 'training_preferences_v1'")
    .first<{ value: string }>();
  const legacy = parseJson<JsonRecord>(row?.value, {});
  const portfolioIds = new Set<string>();
  const childIds = {
    position: new Set<string>(),
    pending: new Set<string>(),
    execution: new Set<string>(),
    rejection: new Set<string>(),
  };
  const portfolioStatements: D1PreparedStatement[] = [];
  const childStatementsByPortfolio: D1PreparedStatement[] = [];
  for (const [index, value] of (Array.isArray(legacy.livePortfolios) ? legacy.livePortfolios : []).entries()) {
    const portfolio = normalizePortfolio(value, index);
    if (!portfolio || portfolioIds.has(portfolio.instrumentId)) continue;
    portfolioIds.add(portfolio.instrumentId);
    portfolioStatements.push(portfolioUpsertStatement(db, portfolio, true));
    childStatementsByPortfolio.push(
      db.prepare("DELETE FROM live_positions WHERE portfolio_instrument_id = ?").bind(portfolio.instrumentId),
      db.prepare("DELETE FROM live_pending_orders WHERE portfolio_instrument_id = ?").bind(portfolio.instrumentId),
      db.prepare("DELETE FROM live_executions WHERE portfolio_instrument_id = ?").bind(portfolio.instrumentId),
      db.prepare("DELETE FROM live_order_rejections WHERE portfolio_instrument_id = ?").bind(portfolio.instrumentId),
    );
    for (const position of portfolio.positions) {
      if (!childIds.position.has(position.id)) {
        childIds.position.add(position.id);
        childStatementsByPortfolio.push(db.prepare(`INSERT OR REPLACE INTO live_positions
          (id, portfolio_instrument_id, side, qty, entry_price, entry_timestamp,
           entry_order_id, status, exit_price, exit_timestamp, exit_order_id, realized_pnl)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(position.id, portfolio.instrumentId, position.side, position.qty, position.entryPrice,
            position.entryTimestamp, position.entryOrderId, position.status, position.exitPrice,
            position.exitTimestamp, position.exitOrderId, position.realizedPnl));
      }
    }
    for (const order of portfolio.pendingOrders) {
      if (!childIds.pending.has(order.id)) {
        childIds.pending.add(order.id);
        childStatementsByPortfolio.push(db.prepare(`INSERT OR REPLACE INTO live_pending_orders
          (id, portfolio_instrument_id, action, side, qty, created_at, position_id,
           rule_id, rule_version, price_band_json, reserved_cash, execute_at_timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(order.id, portfolio.instrumentId, order.action, order.side, order.qty, order.createdAt,
            order.positionId, order.ruleId, order.ruleVersion,
            order.priceBand ? jsonText(order.priceBand, null) : null, order.reservedCash,
            order.executeAtTimestamp));
      }
    }
    for (const execution of portfolio.executions) {
      if (!childIds.execution.has(execution.id)) {
        childIds.execution.add(execution.id);
        childStatementsByPortfolio.push(db.prepare(`INSERT OR REPLACE INTO live_executions
          (id, portfolio_instrument_id, order_id, position_id, action, side, qty,
           price, timestamp, realized_pnl, rule_id, rule_version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(execution.id, portfolio.instrumentId, execution.orderId, execution.positionId,
            execution.action, execution.side, execution.qty, execution.price, execution.timestamp,
            execution.realizedPnl, execution.ruleId, execution.ruleVersion));
      }
    }
    for (const rejection of portfolio.orderRejections) {
      if (!childIds.rejection.has(rejection.id)) {
        childIds.rejection.add(rejection.id);
        childStatementsByPortfolio.push(db.prepare(`INSERT OR REPLACE INTO live_order_rejections
          (id, portfolio_instrument_id, order_id, code, message, timestamp, rule_id, rule_version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(rejection.id, portfolio.instrumentId, rejection.orderId, rejection.code,
            rejection.message, rejection.timestamp, rejection.ruleId, rejection.ruleVersion));
      }
    }
  }
  await runInChunks(db, portfolioStatements);
  await runInChunks(db, childStatementsByPortfolio);

  const watchIds = new Set<string>();
  const watchStatements: D1PreparedStatement[] = [];
  for (const [index, value] of (Array.isArray(legacy.liveWatchlist) ? legacy.liveWatchlist : []).entries()) {
    const watch = normalizeWatch(value, index);
    if (!watch || watchIds.has(watch.instrumentId)) continue;
    watchIds.add(watch.instrumentId);
    watchStatements.push(watchUpsertStatement(db, watch, true));
  }
  await runInChunks(db, watchStatements);
  await db.prepare(
    "INSERT INTO app_metadata (key, value) VALUES ('live_data_migrated_v1', '1')",
  ).run();
}

type PortfolioRow = {
  instrumentId: string;
  symbol: string;
  name: string;
  market: "CN" | "US";
  latestTimestamp: number;
  latestClose: number;
  scanTimestamp: number;
  presetIdsJson: string;
  presetNamesJson: string;
  decisionJson: string | null;
  decisionSubmissionsJson: string;
  tradingMode: "return" | "capital";
  initialCapital: number;
  cashBalance: number;
  updatedAt: string;
};

export async function readLiveState(db: D1Database) {
  const [portfolioResult, positionResult, pendingResult, executionResult, rejectionResult, watchResult] = await Promise.all([
    db.prepare(`SELECT instrument_id AS instrumentId, symbol, name, market,
      latest_timestamp AS latestTimestamp, latest_close AS latestClose,
      scan_timestamp AS scanTimestamp, preset_ids_json AS presetIdsJson,
      preset_names_json AS presetNamesJson, decision_json AS decisionJson,
      decision_submissions_json AS decisionSubmissionsJson, trading_mode AS tradingMode,
      initial_capital AS initialCapital, cash_balance AS cashBalance, updated_at AS updatedAt
      FROM live_portfolios ORDER BY sort_order ASC, updated_at DESC, instrument_id ASC`).all<PortfolioRow>(),
    db.prepare(`SELECT id, portfolio_instrument_id AS portfolioInstrumentId, side, qty,
      entry_price AS entryPrice, entry_timestamp AS entryTimestamp, entry_order_id AS entryOrderId,
      status, exit_price AS exitPrice, exit_timestamp AS exitTimestamp,
      exit_order_id AS exitOrderId, realized_pnl AS realizedPnl
      FROM live_positions ORDER BY id`).all(),
    db.prepare(`SELECT id, portfolio_instrument_id AS portfolioInstrumentId, action, side, qty,
      created_at AS createdAt, position_id AS positionId, rule_id AS ruleId,
      rule_version AS ruleVersion, price_band_json AS priceBandJson,
      reserved_cash AS reservedCash, execute_at_timestamp AS executeAtTimestamp
      FROM live_pending_orders ORDER BY id`).all(),
    db.prepare(`SELECT id, portfolio_instrument_id AS portfolioInstrumentId, order_id AS orderId,
      position_id AS positionId, action, side, qty, price, timestamp,
      realized_pnl AS realizedPnl, rule_id AS ruleId, rule_version AS ruleVersion
      FROM live_executions ORDER BY timestamp, id`).all(),
    db.prepare(`SELECT id, portfolio_instrument_id AS portfolioInstrumentId, order_id AS orderId,
      code, message, timestamp, rule_id AS ruleId, rule_version AS ruleVersion
      FROM live_order_rejections ORDER BY timestamp, id`).all(),
    db.prepare(`SELECT instrument_id AS instrumentId, symbol, name, market,
      latest_timestamp AS latestTimestamp, latest_close AS latestClose,
      observation_timestamp AS observationTimestamp, observation_close AS observationClose,
      entry_timestamp AS entryTimestamp, entry_price AS entryPrice,
      scan_timestamp AS scanTimestamp, preset_ids_json AS presetIdsJson,
      preset_names_json AS presetNamesJson, updated_at AS updatedAt
      FROM live_watchlist ORDER BY sort_order ASC, updated_at DESC, instrument_id ASC`).all(),
  ]);
  const portfolios = (portfolioResult.results as PortfolioRow[]).map((row) => ({
    id: row.instrumentId,
    instrumentId: row.instrumentId,
    symbol: row.symbol,
    name: row.name,
    market: row.market,
    latestTimestamp: row.latestTimestamp,
    latestClose: row.latestClose,
    scanTimestamp: row.scanTimestamp,
    presetIds: parseJson<string[]>(row.presetIdsJson, []),
    presetNames: parseJson<string[]>(row.presetNamesJson, []),
    positions: [] as Array<Record<string, unknown>>,
    pendingOrders: [] as Array<Record<string, unknown>>,
    executions: [] as Array<Record<string, unknown>>,
    orderRejections: [] as Array<Record<string, unknown>>,
    tradingMode: row.tradingMode,
    initialCapital: row.initialCapital,
    cashBalance: row.cashBalance,
    ...(parseJson<JsonRecord | null>(row.decisionJson, null) ? { decision: parseJson<JsonRecord>(row.decisionJson, {}) } : {}),
    decisionSubmissions: parseJson<unknown[]>(row.decisionSubmissionsJson, []),
    updatedAt: row.updatedAt,
  }));
  const portfolioMap = new Map(portfolios.map((portfolio) => [portfolio.instrumentId, portfolio]));
  for (const row of positionResult.results as Array<Record<string, unknown>>) {
    const portfolio = portfolioMap.get(String(row.portfolioInstrumentId));
    if (!portfolio) continue;
    portfolio.positions.push({
      id: String(row.id), side: row.side, qty: Number(row.qty), entryPrice: Number(row.entryPrice),
      entryTimestamp: Number(row.entryTimestamp), entryOrderId: String(row.entryOrderId), status: row.status,
      ...(row.exitPrice === null ? {} : { exitPrice: Number(row.exitPrice) }),
      ...(row.exitTimestamp === null ? {} : { exitTimestamp: Number(row.exitTimestamp) }),
      ...(row.exitOrderId === null ? {} : { exitOrderId: String(row.exitOrderId) }),
      ...(row.realizedPnl === null ? {} : { realizedPnl: Number(row.realizedPnl) }),
    });
  }
  for (const row of pendingResult.results as Array<Record<string, unknown>>) {
    const portfolio = portfolioMap.get(String(row.portfolioInstrumentId));
    if (!portfolio) continue;
    portfolio.pendingOrders.push({
      id: String(row.id), action: row.action, side: row.side, qty: Number(row.qty),
      createdAt: Number(row.createdAt), positionId: String(row.positionId),
      ...(row.ruleId === null ? {} : { ruleId: String(row.ruleId) }),
      ...(row.ruleVersion === null ? {} : { ruleVersion: String(row.ruleVersion) }),
      ...(row.priceBandJson === null ? {} : { priceBand: parseJson(row.priceBandJson as string, null) }),
      ...(row.reservedCash === null ? {} : { reservedCash: Number(row.reservedCash) }),
      ...(row.executeAtTimestamp === null ? {} : { executeAtTimestamp: Number(row.executeAtTimestamp) }),
    });
  }
  for (const row of executionResult.results as Array<Record<string, unknown>>) {
    const portfolio = portfolioMap.get(String(row.portfolioInstrumentId));
    if (!portfolio) continue;
    portfolio.executions.push({
      id: String(row.id), orderId: String(row.orderId), positionId: String(row.positionId),
      action: row.action, side: row.side, qty: Number(row.qty), price: Number(row.price),
      timestamp: Number(row.timestamp), realizedPnl: Number(row.realizedPnl),
      ...(row.ruleId === null ? {} : { ruleId: String(row.ruleId) }),
      ...(row.ruleVersion === null ? {} : { ruleVersion: String(row.ruleVersion) }),
    });
  }
  for (const row of rejectionResult.results as Array<Record<string, unknown>>) {
    const portfolio = portfolioMap.get(String(row.portfolioInstrumentId));
    if (!portfolio) continue;
    portfolio.orderRejections.push({
      id: String(row.id), ...(row.orderId === null ? {} : { orderId: String(row.orderId) }),
      code: String(row.code), message: String(row.message), timestamp: Number(row.timestamp),
      ruleId: String(row.ruleId), ruleVersion: String(row.ruleVersion),
    });
  }
  const watchlist = (watchResult.results as Array<Record<string, unknown>>).map((row) => ({
    id: `watch:${String(row.instrumentId)}`,
    instrumentId: String(row.instrumentId), symbol: String(row.symbol), name: String(row.name),
    market: row.market, latestTimestamp: Number(row.latestTimestamp), latestClose: Number(row.latestClose),
    ...(row.observationTimestamp === null ? {} : { observationTimestamp: Number(row.observationTimestamp) }),
    ...(row.observationClose === null ? {} : { observationClose: Number(row.observationClose) }),
    ...(row.entryTimestamp === null ? {} : { entryTimestamp: Number(row.entryTimestamp) }),
    ...(row.entryPrice === null ? {} : { entryPrice: Number(row.entryPrice) }),
    scanTimestamp: Number(row.scanTimestamp),
    presetIds: parseJson<string[]>(String(row.presetIdsJson), []),
    presetNames: parseJson<string[]>(String(row.presetNamesJson), []),
    updatedAt: String(row.updatedAt),
  }));
  return { portfolios, watchlist };
}

export async function applyLiveStatePatch(db: D1Database, value: unknown) {
  if (!isRecord(value)) throw new Error("live state patch must be an object");
  const hasPortfolios = Object.prototype.hasOwnProperty.call(value, "portfolioUpserts")
    || Object.prototype.hasOwnProperty.call(value, "portfolioDeletes");
  const hasWatchlist = Object.prototype.hasOwnProperty.call(value, "watchlistUpserts")
    || Object.prototype.hasOwnProperty.call(value, "watchlistDeletes");
  if (!hasPortfolios && !hasWatchlist) throw new Error("live state patch is empty");
  const portfolioUpserts = (Array.isArray(value.portfolioUpserts) ? value.portfolioUpserts : [])
    .slice(0, MAX_LIVE_ITEMS)
    .map((item, index) => normalizePortfolio(item, index))
    .filter((item): item is NormalizedPortfolio => Boolean(item));
  const watchUpserts = (Array.isArray(value.watchlistUpserts) ? value.watchlistUpserts : [])
    .slice(0, MAX_LIVE_ITEMS)
    .map((item, index) => normalizeWatch(item, index))
    .filter((item): item is NormalizedWatch => Boolean(item));
  const portfolioDeletes = normalizeDeletes(value.portfolioDeletes);
  const watchDeletes = normalizeDeletes(value.watchlistDeletes);
  const portfolioIds = new Set<string>();
  const watchIds = new Set<string>();
  let portfolioUpdated = 0;
  let portfolioSkipped = 0;
  let watchUpdated = 0;
  let watchSkipped = 0;
  for (const portfolio of portfolioUpserts) {
    if (portfolioIds.has(portfolio.instrumentId)) continue;
    portfolioIds.add(portfolio.instrumentId);
    const result = await portfolioUpsertStatement(db, portfolio).run();
    const changed = (result as { meta?: { changes?: number } }).meta?.changes;
    if (changed === 0) {
      portfolioSkipped += 1;
      continue;
    }
    await runInChunks(db, childStatements(db, portfolio));
    portfolioUpdated += 1;
  }
  for (const item of portfolioDeletes) {
    if (portfolioIds.has(item.instrumentId)) continue;
    const result = await db.prepare(`DELETE FROM live_portfolios
      WHERE instrument_id = ? AND (? IS NULL OR updated_at <= ?)`)
      .bind(item.instrumentId, item.updatedAt, item.updatedAt).run();
    const changed = (result as { meta?: { changes?: number } }).meta?.changes;
    if (changed === 0) continue;
    await db.batch([
      db.prepare("DELETE FROM live_positions WHERE portfolio_instrument_id = ?").bind(item.instrumentId),
      db.prepare("DELETE FROM live_pending_orders WHERE portfolio_instrument_id = ?").bind(item.instrumentId),
      db.prepare("DELETE FROM live_executions WHERE portfolio_instrument_id = ?").bind(item.instrumentId),
      db.prepare("DELETE FROM live_order_rejections WHERE portfolio_instrument_id = ?").bind(item.instrumentId),
    ]);
    portfolioUpdated += 1;
  }
  for (const watch of watchUpserts) {
    if (watchIds.has(watch.instrumentId)) continue;
    watchIds.add(watch.instrumentId);
    const result = await watchUpsertStatement(db, watch).run();
    const changed = (result as { meta?: { changes?: number } }).meta?.changes;
    if (changed === 0) watchSkipped += 1;
    else watchUpdated += 1;
  }
  for (const item of watchDeletes) {
    if (watchIds.has(item.instrumentId)) continue;
    const result = await db.prepare(`DELETE FROM live_watchlist
      WHERE instrument_id = ? AND (? IS NULL OR updated_at <= ?)`)
      .bind(item.instrumentId, item.updatedAt, item.updatedAt).run();
    const changed = (result as { meta?: { changes?: number } }).meta?.changes;
    if (changed !== 0) watchUpdated += 1;
  }
  return { portfolioUpdated, portfolioSkipped, watchUpdated, watchSkipped };
}
