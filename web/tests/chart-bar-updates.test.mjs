import test from 'node:test';import assert from 'node:assert/strict';import { incrementalBarUpdates } from '../app/lib/chartBarUpdates.mjs';
const bar=(timestamp,close=2,volume=1)=>({timestamp,open:2,high:3,low:1,close,volume});
test('incremental chart updates distinguish no change, final quote and rollover close correction',()=>{
 const before=[bar(1),bar(2)];assert.deepEqual(incrementalBarUpdates(before,before.map(b=>({...b}))),[]);
 assert.deepEqual(incrementalBarUpdates(before,[bar(1),bar(2,2.5,3)]),[bar(2,2.5,3)]);
 assert.deepEqual(incrementalBarUpdates(before,[bar(1),bar(2,2.5,3),bar(3)]),[bar(2,2.5,3),bar(3)]);
});
test('history correction, truncation or changed window require an authoritative reload',()=>{
 const before=[bar(1),bar(2)];for(const next of [[bar(1,2.5),bar(2)],[bar(2),bar(3)],[bar(1)],[]])assert.equal(incrementalBarUpdates(before,next),null);
 assert.equal(incrementalBarUpdates([], [bar(1)]),null);
});

test('replay steps append only new candles across short and long training windows',()=>{
 for(const count of [40, 999, 1000, 1001, 5000]){
  const before=Array.from({length:count},(_,i)=>bar(i+1));
  const appended=[bar(count+1)];
  assert.deepEqual(incrementalBarUpdates(before,[...before,...appended]),appended);
 }
});

test('overnight minute and chart-timeframe jumps use one authoritative batch instead of recalculating indicators per candle',()=>{
 for(const count of [40, 1000, 5000]){
  const before=Array.from({length:count},(_,i)=>bar(i+1));
  for(const jump of [3, 5, 53, 795]){
   const appended=Array.from({length:jump},(_,i)=>bar(count+i+1));
   assert.equal(incrementalBarUpdates(before,[...before,...appended]),null);
  }
  assert.deepEqual(incrementalBarUpdates(before,[...before,bar(count+1),bar(count+2)]),[bar(count+1),bar(count+2)]);
  assert.equal(incrementalBarUpdates(before,[...before.slice(0,-1),bar(count,2.5),bar(count+1),bar(count+2)]),null);
 }
});

test('a partial timeframe candle is corrected before the next candle is appended',()=>{
 const before=[bar(1),bar(2)];
 const final={...bar(2,2.8,10),high:4};
 const next=bar(3,2.9,2);
 assert.deepEqual(incrementalBarUpdates(before,[before[0],final,next]),[final,next]);
 assert.equal(incrementalBarUpdates([before[0],final,next],[before[0],final]),null);
 assert.equal(incrementalBarUpdates(before,[{...bar(1),high:4},before[1],next]),null);
});
