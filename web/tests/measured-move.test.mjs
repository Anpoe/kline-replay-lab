import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { measuredMoveOverlay } from '../app/lib/measuredMove.ts';
import { rectangleControlPoints } from '../app/lib/rectangleDrawing.ts';

function figures(start, middle, options = {}) {
  const map = options.map ?? (value => 6000 - value);
  const overlay = { paneId: 'candle_pane', points: [{ value: start }, { value: middle }], styles: { line: { color: '#20c997', size: 3 } } };
  const chart = {
    getSymbol: () => ({ pricePrecision: options.precision ?? 2 }),
    getStyles: () => ({ candle: { priceMark: { show: !options.hidePrice } }, overlay: { line: { color: '#888888', size: 1 }, text: { size: 12 } } }),
    convertToPixel: ({ value }, { paneId }) => { assert.equal(paneId, 'candle_pane'); return { y: map(value) }; },
  };
  return measuredMoveOverlay.createPointFigures({ chart, overlay, coordinates: [{ x: options.reverseX ? 300 : 100, y: map(start) }, { x: options.reverseX ? 100 : 300, y: map(middle) }] });
}
const labels = values => values.filter(f => f.type === 'text').map(f => f.attrs.text);

test('two selected prices project an equal second leg in either direction, as in the reference', () => {
  assert.deepEqual(labels(figures(5064.25, 5052.75)), ['0 (5064.25)', '0.5 (5052.75)', '1 (5041.25)']);
  assert.deepEqual(labels(figures(5041.25, 5052.75)), ['0 (5041.25)', '0.5 (5052.75)', '1 (5064.25)']);
  assert.deepEqual(labels(figures(5065.5, 5049.375)), ['0 (5065.50)', '0.5 (5049.38)', '1 (5033.25)']);
});

test('target geometry uses the price-axis conversion rather than assuming a linear scale', () => {
  const map = value => 1000 - Math.log(value) * 100;
  const lines = figures(100, 150, { map, reverseX: true }).filter(f => f.type === 'line');
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[2].attrs.coordinates, [{ x: 100, y: map(200) }, { x: 300, y: map(200) }]);
  assert.equal(lines[2].styles.color, '#20c997');assert.equal(lines[2].styles.size, 3);
});

test('FX precision, zero distance and hidden-price training remain usable', () => {
  assert.deepEqual(labels(figures(1.1, 1.10025, { precision: 5 })), ['0 (1.10000)', '0.5 (1.10025)', '1 (1.10050)']);
  assert.deepEqual(labels(figures(10, 10)), ['0 (10.00)', '0.5 (10.00)', '1 (10.00)']);
  assert.deepEqual(labels(figures(10, 12, { hidePrice: true })), ['0', '0.5', '1']);
  assert.equal(measuredMoveOverlay.needDefaultYAxisFigure, false, 'hidden-price training cannot leak anchor prices');
});

test('unfinished, non-finite and overflowing measurements never draw invalid prices', () => {
  for (const [a, b] of [[NaN, 10], [10, undefined], [10, Infinity], [-Number.MAX_VALUE, Number.MAX_VALUE]]) assert.deepEqual(figures(a, b), []);
});

test('new and restored drawings retain their native edit handles; text keeps its explicit selection override', () => {
  const source = readFileSync(new URL('../app/components/KLineReplayChart.tsx', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('chart.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let restore, create;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'createPersistedDrawing') restore = node.initializer.getText(parsed);
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'chart.createOverlay' && node.arguments[0]?.getText(parsed).includes('name: drawingRequest.name')) create = node.getText(parsed);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  const compile = expression => ts.transpileModule(`return ${expression};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let options;
  const chart = { createOverlay: value => { options = value; return 'drawing'; }, getOverlays: () => [], getDataList: () => [] };
  const createDrawing = new Function('chart', 'drawingRequest', 'const USER_DRAWING_GROUP = "drawings", rememberDrawingContext = () => {};\n' + compile(create));
  const restoreDrawing = new Function('useCallback', 'USER_DRAWING_GROUP', 'dataIndexOffsetRef', 'selectedTrainingTextId', 'enableTextBoxFreeMovement', 'rememberDrawingContext', 'rectangleControlPoints', compile(restore))(fn => fn, 'drawings', { current: 0 }, '', () => {}, () => {}, rectangleControlPoints);
  for (const name of ['trainingMeasuredMove', 'fibonacciLine', 'trainingRectangle']) {
    createDrawing(chart, { name });
    assert.equal(Object.hasOwn(options, 'needDefaultPointFigure'), false, 'creating must inherit the template default');
    restoreDrawing(chart, { name, id: 'drawing', points: [] });
    assert.equal(Object.hasOwn(options, 'needDefaultPointFigure'), false, 'restoring must inherit the template default');
  }
  createDrawing(chart, { name: 'trainingTextBox' });assert.equal(options.needDefaultPointFigure, false);
  restoreDrawing(chart, { name: 'trainingTextBox', id: 'drawing', points: [] });assert.equal(options.needDefaultPointFigure, false);
});
