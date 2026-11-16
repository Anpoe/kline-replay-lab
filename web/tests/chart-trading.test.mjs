import test from 'node:test';
import assert from 'node:assert/strict';
import { chartOrderChoicesAtPrice, pendingOrderIdsAtPrice, protectionKindAtPrice } from '../app/lib/chartTrading.ts';

test('above-market menus offer sell limit and buy stop; below-market menus offer buy limit and sell stop', () => {
  assert.deepEqual(chartOrderChoicesAtPrice(2010,2000,2000),[{side:'sell',orderType:'limit'},{side:'buy',orderType:'stop'}]);
  assert.deepEqual(chartOrderChoicesAtPrice(1990,2000,2000),[{side:'buy',orderType:'limit'},{side:'sell',orderType:'stop'}]);
  assert.deepEqual(chartOrderChoicesAtPrice(2000,2000,2000),[]);
});

test('MT4 buy choices use Ask and sell choices use Bid, including the spread and equal-quote boundaries', () => {
  assert.deepEqual(chartOrderChoicesAtPrice(2001,2002,2000),[{side:'buy',orderType:'limit'},{side:'sell',orderType:'limit'}]);
  assert.deepEqual(chartOrderChoicesAtPrice(2000,2002,2000),[{side:'buy',orderType:'limit'}]);
  assert.deepEqual(chartOrderChoicesAtPrice(2002,2002,2000),[{side:'sell',orderType:'limit'}]);
  for(const price of [0,-1,NaN,Infinity]) assert.deepEqual(chartOrderChoicesAtPrice(price,2002,2000),[]);
  assert.deepEqual(chartOrderChoicesAtPrice(2001,0,2000),[]);
});

test('current price drags choose protection relative to the current quote, including profitable stops', () => {
  assert.equal(protectionKindAtPrice('long', 2010, 2020), 'stop-loss');
  assert.equal(protectionKindAtPrice('long', 2030, 2020), 'take-profit');
  assert.equal(protectionKindAtPrice('short', 2030, 2020), 'stop-loss');
  assert.equal(protectionKindAtPrice('short', 2010, 2020), 'take-profit');
  for (const price of [2020, 0, -1, NaN, Infinity]) assert.equal(protectionKindAtPrice('long', price, 2020), null);
  assert.equal(protectionKindAtPrice('long', 2000, NaN), null);
});

test('right-clicking coincident pending lines offers only those orders, leaving other prices and invalid levels out', () => {
  const orders=[{id:'limit',price:100},{id:'stop',price:100.01},{id:'other',price:101},{id:'bad',price:NaN}];
  assert.deepEqual(pendingOrderIdsAtPrice(orders,100,.02),['limit','stop']);
  assert.deepEqual(pendingOrderIdsAtPrice(orders,99,.02),[]);
});
