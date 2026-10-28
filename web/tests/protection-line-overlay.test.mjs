import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../app/components/KLineReplayChart.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('chart.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'syncProtectionLines');
const code = ts.transpileModule(declaration.getText(parsed) + '\nexport { syncProtectionLines };', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const runtime = {};
new Function('exports', 'PROTECTION_LINE_GROUP', code)(runtime, 'protection-lines');
const line = { id: 'one', kind: 'stop-loss', price: 1990, timestamp: 1000, label: '订单止损', source: 'position', movable: true };
function fixture(onMove) {
  const overlays = new Map(), restored = [];
  const chart = { removeOverlay() { overlays.clear(); }, createOverlay(overlay) { overlays.set(overlay.id, overlay); }, getOverlays({ id }) { return overlays.has(id) ? [overlays.get(id)] : []; }, overrideOverlay(update) { restored.push(update); } };
  runtime.syncProtectionLines(chart, [line], (current, price) => onMove({ chart, overlays, current, price }));
  const overlay = overlays.get('protection:one');
  return { chart, overlays, restored, drop() { overlay.onPressedMoveEnd({ chart, overlay: { ...overlay, points: [{ timestamp: 1000, value: 1995 }] } }); } };
}

test('a rejected stale drag restores the latest terminal level rather than its drag-start price', () => {
  const f = fixture(({ overlays, current, price }) => {
    assert.equal(current.price, 1990); assert.equal(price, 1995);
    overlays.set('protection:one', { extendData: { ...line, price: 1992, timestamp: 2000 } });
    return false;
  });
  f.drop();
  assert.deepEqual(f.restored, [{ id: 'protection:one', points: [{ timestamp: 2000, value: 1992 }] }]);
});

test('a drag callback from a removed order or switched account cannot restore an obsolete line', () => {
  const f = fixture(({ overlays }) => { overlays.clear(); return false; });
  f.drop(); assert.deepEqual(f.restored, []);
});

test('normal refusal restores the acknowledged price, while an accepted move is left for confirmation', () => {
  const refused = fixture(() => false); refused.drop();
  assert.equal(refused.restored[0].points[0].value, 1990);
  const accepted = fixture(() => true); accepted.drop(); assert.deepEqual(accepted.restored, []);
});
