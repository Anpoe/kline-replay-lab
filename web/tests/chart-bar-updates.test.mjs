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
