import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { interpolatedDrawingIndex, remapReplayDrawingPoints } from '../app/lib/timeframeView.ts';

const source = readFileSync(new URL('../app/components/KLineReplayChart.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('chart.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = ['positiveNumber', 'syncTrainingTextBoxScale'].map(name => parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(parsed));
const scale = new Function('interpolatedDrawingIndex', ts.transpileModule(declarations.join('\n') + '\nreturn syncTrainingTextBoxScale;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(interpolatedDrawingIndex);
function fixture() {
  const overlay = { id: 'text', name: 'trainingTextBox', points: [{ dataIndex: 0, value: 0 }, { dataIndex: 180, value: 60 }], styles: { text: { size: 18, color: '#ffffff' } }, extendData: { text: '关键支撑' } };
  const chart = { getDataList: () => [], convertToPixel: points => points.map(p => ({ x: p.dataIndex, y: p.value })), overrideOverlay: update => Object.assign(overlay, update) };
  scale(chart, overlay, true);
  return { overlay, chart };
}

test('small text-box drags retain fractional sizes and preview successive changes', () => {
  const { chart, overlay } = fixture();
  overlay.points[1].dataIndex = 181;
  scale(chart, overlay);
  assert.ok(Math.abs(overlay.styles.text.size - 18.1) < 1e-9);
  overlay.points[1].dataIndex = 182;
  scale(chart, overlay);
  assert.ok(Math.abs(overlay.styles.text.size - 18.2) < 1e-9);
  assert.equal(overlay.styles.text.color, '#ffffff');
  assert.equal(overlay.extendData.text, '关键支撑');
});

test('a new drag rebases after resizing, manual font changes and chart zoom', () => {
  const { chart, overlay } = fixture();
  overlay.points[1].dataIndex = 360;
  scale(chart, overlay);
  assert.equal(overlay.styles.text.size, 36);
  overlay.styles.text.size = 20.5;
  overlay.points[1].dataIndex = 720;
  scale(chart, overlay, true);
  scale(chart, overlay);
  assert.equal(overlay.styles.text.size, 20.5);
  overlay.points[1].value = 66;
  scale(chart, overlay);
  assert.ok(Math.abs(overlay.styles.text.size - 22.55) < 1e-9);
});

test('moving a whole text box preserves size and resizing respects readable bounds', () => {
  const { chart, overlay } = fixture();
  overlay.points = overlay.points.map(p => ({ dataIndex: p.dataIndex + 15, value: p.value + 20 }));
  scale(chart, overlay);
  assert.equal(overlay.styles.text.size, 18);
  overlay.points[1].dataIndex = 100000;
  scale(chart, overlay);
  assert.equal(overlay.styles.text.size, 96);
  overlay.points[1] = { dataIndex: 16, value: 21 };
  scale(chart, overlay);
  assert.equal(overlay.styles.text.size, 10);
});

test('text positions keep sub-bar timestamps through timeframe remapping, saving and paging', () => {
  const bars = [{ timestamp: 1000 }, { timestamp: 2000 }, { timestamp: 5000 }];
  for (const [timestamp, expected] of [[1500, 0.5], [3500, 1.5], [8000, 3], [500, -0.5]]) assert.equal(interpolatedDrawingIndex(bars, timestamp), expected);
  const drawing = { name: 'trainingTextBox', points: [{ timestamp: 3500, dataIndex: 1.5, value: 10 }] };
  const mapped = remapReplayDrawingPoints(drawing, bars, [{ timestamp: 1000 }, { timestamp: 6000 }], 0, 100);
  assert.deepEqual(mapped.points, [{ timestamp: 3500, dataIndex: 100.5, value: 10 }]);
  assert.equal(JSON.parse(JSON.stringify(mapped)).points[0].timestamp, 3500);
  assert.equal(interpolatedDrawingIndex([{ timestamp: 0 }, ...bars], 3500), 2.5);
  const line = remapReplayDrawingPoints({ ...drawing, name: 'segment' }, bars, [{ timestamp: 1000 }, { timestamp: 6000 }]);
  assert.equal(line.points[0].timestamp, 1000, 'line magnet and snapping behavior stays unchanged');
});

test('free text movement enables the existing native sub-bar path and disables price magnets only for text', () => {
  const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'enableTextBoxFreeMovement');
  const enable = new Function(ts.transpileModule(declaration.getText(parsed) + '\nreturn enableTextBoxFreeMovement;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)();
  const text = { name: 'trainingTextBox', drawingMode: 'step', mode: 'strong_magnet' };
  enable(text);
  assert.equal(text.drawingMode, 'continuous');assert.equal(text.mode, 'normal');
  const line = { ...text, name: 'segment', drawingMode: 'step', mode: 'strong_magnet' };
  enable(line);assert.equal(line.drawingMode, 'step');assert.equal(line.mode, 'strong_magnet');
});

const nodeRequire = createRequire(import.meta.url);
const barCode = ts.transpileModule(readFileSync(new URL('../app/components/DrawingPropertyBar.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function controls() {
  let draft = null;
  const exports = {}, values = [];
  new Function('require', 'exports', barCode)(id => id === 'react' ? { useRef: () => ({current:null}), useId: () => 'size-hint', useState: () => [draft, value => { draft = value; }] } : id.includes('chartDrawingTools') ? { drawingLabel: () => '文字标记' } : nodeRequire(id), exports);
  const render = () => {
    const tree = exports.DrawingPropertyBar({ drawing: { id: 'text', name: 'trainingTextBox' }, textSize: values.at(-1) ?? 18, text: '支撑', color: '#ffffff', lineWidth: 1, onTextSize: value => values.push(value) });
    const inputs = [];
    const visit = node => { if (Array.isArray(node)) node.forEach(visit); else if (node?.props) { if (node.type === 'input') inputs.push(node.props); visit(node.props.children); } };
    visit(tree);
    return { range: inputs.find(p => p.type === 'range'), number: inputs.find(p => p.type === 'number') };
  };
  return { render, values };
}
test('shared font controls accept fine slider increments and decimal typing with recoverable empty drafts', () => {
  const f = controls();
  const { range, number } = f.render();
  assert.equal(range.step, 0.1);
  assert.equal(number.step, 0.1);
  range.onChange({ target: { valueAsNumber: 18.1 } });
  number.onChange({ target: { value: '', valueAsNumber: NaN } });
  assert.equal(f.render().number.value, '');
  number.onChange({ target: { value: '18.7', valueAsNumber: 18.7 } });
  assert.deepEqual(f.values, [18.1, 18.7]);
  number.onBlur({ target: { value: '', valueAsNumber: NaN } });
  assert.equal(f.render().number.value, 18.7);
  number.onChange({ target: { value: '200', valueAsNumber: 200 } });
  assert.equal(f.values.at(-1), 18.7);
  number.onBlur({ target: { value: '200', valueAsNumber: 200 } });
  assert.equal(f.values.at(-1), 96);
});
