import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function bodyOf(source, name) {
  const start = source.indexOf('{', source.indexOf('bool ' + name + '('));
  let end = start + 1, depth = 1;
  while (depth) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
  return source.slice(start + 1, end - 1).replace(/\b(?:double|bool|int|string)\s+/g, 'var ').replace(/BOSymbolInfo (\w+);/g, 'var $1={};');
}

// Run the math header's actual scalar/array logic against broker doubles.
// MetaEditor separately compiles the complete EA and MQL reference signatures.
async function math() {
  const source = await readFile(new URL('../public/mt4/BatchOrderMath.mqh', import.meta.url), 'utf8');
  const api = { OP_BUY: 0, OP_SELL: 1, OP_BUYLIMIT: 2, OP_SELLLIMIT: 3, OP_BUYSTOP: 4, OP_SELLSTOP: 5, BO_MAX_ROWS: 10, BO_UNIT_PIPS: 0, BO_UNIT_PERCENT: 1, BO_UNIT_PL: 2, BO_LOTS_FIXED: 0, BO_LOTS_RISK: 1,
    MathIsValidNumber: Number.isFinite, MathFloor: Math.floor, MathCeil: Math.ceil, MathRound: Math.round, MathAbs: Math.abs, MathMax: Math.max,
    NormalizeDouble: (n, digits) => Number(n.toFixed(digits)), StringFormat: (s, ...args) => s.replace(/%[dsf]/g, () => String(args.shift())),
  };
  for (const match of source.matchAll(/^(?:bool|double|int|string) (BO_\w+)\(([^)]*)\)\s*\{/gm)) {
    const start = match.index + match[0].length; let end = start, depth = 1;
    while (depth) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
    let body = source.slice(start, end - 1).replace(/\b(?:double|bool|int|string)\s+/g, 'var ');
    const params = match[2].replace(/\b(?:double|bool|int|string|BOSymbolInfo|BOOrderSpec|BOOrderPlan)\s*&?/g, '').replace(/\[\]/g, '');
    if (match[1] === 'BO_DirectionalPrices') {
      const calculate = new Function('api', 'orderType', 'referencePrice', 'slDistance', 'tpDistance', 'info', `with(api){var slPrice=0,tpPrice=0;var ok=(()=>{${body}})();return {ok,slPrice,tpPrice};}`);
      api[match[1]] = (type, price, sl, tp, info, out) => { const result = calculate(api, type, price, sl, tp, info); out.slPrice = result.slPrice; out.tpPrice = result.tpPrice; return result.ok; };
    } else {
      body = body.replace(/plans\[i\]\.slPrice,\s*plans\[i\]\.tpPrice/g, 'plans[i]');
      api[match[1]] = new Function('api', `with(api){return function(${params}){${body}}}`)(api);
    }
  }
  return api;
}
const info = { digits: 2, point: .01, tickSize: .01, tickValue: 1, minLot: .01, maxLot: 100, lotStep: .01, stopLevelPoints: 10, freezeLevelPoints: 0 };
const specs = Array.from({ length: 10 }, () => ({ slUnit: 0, slValue: 100, tpUnit: 0, tpValue: 200 }));
function plan(api, type, price, risk = false) {
  const plans = Array.from({ length: 10 }, () => ({}));
  return { ok: api.BO_ComputeBatchPlans(type, 2000, 2000.1, 10000, risk ? 1 : 0, .05, 1, 3, specs, info, plans, '', price), plans };
}
test('native batch math supports all four pending types and derives per-row protection from entry', async () => {
  const api = await math();
  for (const [type, price] of [[2, 1990], [3, 2010], [4, 2010], [5, 1990]]) {
    const result = plan(api, type, price); assert.equal(result.ok, true, 'pending type ' + type);
    assert.ok(result.plans.slice(0, 3).every(row => row.referencePrice === price && row.lots === .05 && row.slPrice === price + (type % 2 ? 1 : -1) && row.tpPrice === price + (type % 2 ? -2 : 2)));
  }
});
test('native pending math refuses wrong side, missing price, stop distance and tick misalignment', async () => {
  const api = await math();
  for (const [type, price] of [[2, 2010], [3, 1990], [4, 1990], [5, 2010], [2, 0], [2, 2000.05], [3, 2000.05], [2, 1990.005]]) assert.equal(plan(api, type, price).ok, false, `invalid ${type}@${price}`);
});
test('native market planning stays compatible and pending risk is split across the batch', async () => {
  const api = await math();
  assert.equal(plan(api, 0, 0).ok, true); assert.equal(plan(api, 1, 0).ok, true);
  const pending = plan(api, 2, 1990, true); assert.equal(pending.ok, true);
  const risk = pending.plans.slice(0, 3).reduce((sum, row) => sum + row.lots * row.lossPerLot, 0);
  assert.ok(risk <= 100 && risk > 97, 'Total risk remains one percent across all three orders');
});

test('native sender preserves pending type/price/protection, rejects changed quotes and never uses market ECN fallback', async () => {
  const source = await readFile(new URL('../public/mt4/BatchOrderPanelEA.mq4', import.meta.url), 'utf8');
  const send = new Function('api', 'orderType', 'plan', `with(api){var result='';return (()=>{${bodyOf(source, 'SendPlannedOrder')}})();}`);
  for (const type of [2, 3, 4, 5]) for (const failure of [0, 130, 128, 'price-changed']) {
    const api = await math(), calls = [], price = type === 2 || type === 5 ? 1990 : 2010;
    Object.assign(api, { Bid: 2000, Ask: 2000.1, Digits: 2, gSlippagePoints: 20, gMagicNumber: 7, clrNONE: 0, SELECT_BY_TICKET: 1, ERR_INVALID_STOPS: 130, BO_TRADE_MAX_ATTEMPTS: 3,
      Symbol: () => 'XAUUSD', RefreshRates: () => { if (failure === 'price-changed') { api.Bid = 1980; api.Ask = 1980.1; } },
      LoadSymbolInfo: target => { Object.assign(target, info); return true; }, ResetLastError: () => {}, GetLastError: () => failure || 0,
      OrderSend: (...args) => { calls.push(args); return failure ? -1 : 123; }, BO_TradeErrorRetryable: () => false, BO_TradeRetrySleep: () => { throw Error('Unexpected retry'); }, TradeErrorText: String,
      OrderSelect: () => { throw Error('Pending orders must not enter the market fallback'); }, OrderModify: () => { throw Error('Unexpected fallback'); },
    });
    const sl = price + (type % 2 ? 1 : -1), tp = price + (type % 2 ? -2 : 2);
    assert.equal(send(api, type, { valid: true, lots: .05, referencePrice: price, slPrice: sl, tpPrice: tp }), !failure);
    if (failure === 'price-changed' && (type === 2 || type === 5)) assert.equal(calls.length, 0);
    else { assert.equal(calls.length, 1); assert.equal(calls[0][1], type); assert.equal(calls[0][3], price); assert.equal(calls[0][5], sl); assert.equal(calls[0][6], tp); }
  }
});
