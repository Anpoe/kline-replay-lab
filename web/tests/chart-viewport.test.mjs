import test from 'node:test';
import assert from 'node:assert/strict';
import { chartShiftPlacement, isCandleInViewport } from '../app/lib/chartViewport.mjs';

test('the candle center stays under the triangle for every zoom level and shift position', () => {
  for (const width of [280, 640, 1000, 1800]) for (const barSpace of [2, 8, 18, 80, 200]) for (const percent of [5, 20, 38, 50]) {
    const placement = chartShiftPlacement(width, barSpace, percent);
    const candleX = Math.floor(width - placement.rightOffset - barSpace / 2 + 0.5);
    assert.ok(Math.abs(candleX - placement.x) <= 0.5);
    assert.equal(placement.x, width * (1 - percent / 100));
  }
  assert.deepEqual(chartShiftPlacement(1000, 100, 20), { x: 800, rightOffset: 150, percent: 20 });
});
test('placement uses the current plot width and handles unavailable sizes without moving a chart', () => {
  for (const width of [0, -1, NaN, Infinity]) assert.equal(chartShiftPlacement(width, 8, 20), null);
  for (const barSpace of [0, -1, NaN, Infinity]) assert.equal(chartShiftPlacement(1000, barSpace, 20), null);
  assert.equal(chartShiftPlacement(1000, 8, -10).percent, 5);
  assert.equal(chartShiftPlacement(1000, 8, 80).percent, 50);
  assert.equal(chartShiftPlacement(1000, 8, NaN).percent, 20);
});

test('latest-candle visibility includes partially visible bodies and excludes offscreen history', () => {
  for (const x of [0, 5, 800, 999, 1000, -4, 1004]) assert.equal(isCandleInViewport(x,1000,10),true);
  for (const x of [-5,-100,1005,1500,NaN,Infinity,undefined]) assert.equal(isCandleInViewport(x,1000,10),false);
  assert.equal(isCandleInViewport(0,0,10),false);
  assert.equal(isCandleInViewport(0,1000,0),false);
});
