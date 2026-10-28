import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultMt4OrderSettings, resizeMt4BatchRows, readMt4OrderSettings, saveMt4OrderSettings } from '../app/features/mt4/mt4OrderSettings.ts';

test('batch settings survive reload and remain isolated by account and instrument, not timeframe', () => {
  const data = new Map(), storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const settings = { ...defaultMt4OrderSettings(), count: '3', orderType: 'limit', sizingMode: 'risk-percent', riskPercent: '2', price: '1990', sl: '1980', tp: '2010' };
  settings.rows = resizeMt4BatchRows([], 3, { price: settings.price, sl: settings.sl, tp: settings.tp, lots: '.02' });
  settings.rows[1] = { price: '1989', sl: '1975', tp: '2000', lots: '.03' };
  assert.equal(saveMt4OrderSettings(storage, 'account-a', 'XAUUSD', settings).saved, true);
  assert.deepEqual(readMt4OrderSettings(storage, 'account-a', 'XAUUSD').value, settings);
  assert.equal(readMt4OrderSettings(storage, 'account-b', 'XAUUSD').value.count, '1');
  assert.equal(readMt4OrderSettings(storage, 'account-a', 'EURUSD').value.count, '1');
  const reduced = resizeMt4BatchRows(settings.rows, 1, settings.rows[0]);
  assert.deepEqual(resizeMt4BatchRows(reduced, 3, settings.rows[0]), settings.rows, 'Reducing count preserves inactive rows');
});
test('invalid storage is not silently overwritten, read/write failures are recoverable, partial input is retained', () => {
  let writes = 0;
  const bad = { getItem: () => '{broken', setItem: () => { writes++; } };
  assert.match(readMt4OrderSettings(bad, 'a', 'XAUUSD').error, /读取|损坏/); assert.equal(writes, 0);
  const fail = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('quota'); } };
  assert.ok(readMt4OrderSettings(fail, 'a', 'XAUUSD').error);
  assert.equal(saveMt4OrderSettings(fail, 'a', 'XAUUSD', defaultMt4OrderSettings()).saved, false);
  const partial = { ...defaultMt4OrderSettings(), count: '', price: '12.' }, data = new Map(), storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  saveMt4OrderSettings(storage, 'a', 'XAUUSD', partial); assert.deepEqual(readMt4OrderSettings(storage, 'a', 'XAUUSD').value, partial);
});
