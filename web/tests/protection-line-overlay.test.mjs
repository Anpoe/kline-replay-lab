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

test('native right-click on either the text figure or line routes the bound marker and prevents deleting its overlay',()=>{
  for(const figure of ['text','line']){
    let hit,prevented=false;const f=fixture(()=>false);
    runtime.syncProtectionLines(f.chart,[line],()=>false,'protection-lines',current=>{hit=current;});
    const overlay=f.overlays.get('protection:one');
    overlay.onRightClick({overlay,figure:{type:figure},preventDefault(){prevented=true;}});
    assert.equal(hit,line);assert.equal(prevented,true);assert.equal(f.overlays.size,1);
  }
});

const currentDeclaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'syncCurrentPriceLine');
const currentCode = ts.transpileModule(currentDeclaration.getText(parsed) + '\nexport { syncCurrentPriceLine };', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const currentRuntime = {};
new Function('exports', currentCode)(currentRuntime);
function currentFixture() {
  const overlays = new Map(), moves = [], dragging = { current: false };
  const chart = { getOverlays: ({id}) => overlays.has(id) ? [overlays.get(id)] : [], removeOverlay: () => overlays.clear(), createOverlay: overlay => overlays.set(overlay.id, overlay), overrideOverlay: update => Object.assign(overlays.get(update.id), update) };
  const current = { ...line, id: 'current-price:account-a', price: 2000 };
  const update = level => currentRuntime.syncCurrentPriceLine(chart, level, (level, price) => moves.push({level,price}), dragging);
  update(current);
  return {chart, overlays, moves, dragging, current, update, overlay: overlays.values().next().value};
}

test('current-price drag captures the drop but restores the newest quote without moving the market line', () => {
  const f = currentFixture();
  f.overlay.onPressedMoveStart({overlay:f.overlay});
  f.overlay.points = [{timestamp:1000, value:1995}];
  f.update({...f.current, timestamp:2000, price:2002});
  assert.equal(f.overlay.points[0].value,1995,'quote updates must not interrupt an in-progress drag');
  f.overlay.onPressedMoveEnd({chart:f.chart,overlay:f.overlay});
  assert.equal(f.moves[0].price,1995);
  assert.equal(f.moves[0].level.price,2002);
  assert.deepEqual(f.overlay.points,[{timestamp:2000,value:2002}]);
  assert.equal(f.dragging.current,false);
});

test('disabled trading, flattening and account switching discard an old current-price drag', () => {
  for (const replacement of [null,{...line,id:'current-price:account-b',price:2010}]) {
    const f=currentFixture();f.overlay.onPressedMoveStart({overlay:f.overlay});
    f.update(replacement);
    f.overlay.onPressedMoveEnd({chart:f.chart,overlay:{...f.overlay,points:[{value:1995}]}});
    assert.deepEqual(f.moves,[]);
    assert.equal(f.dragging.current,false);
  }
});

test('holding the current-price line through a quote update without dragging submits nothing', () => {
  const f=currentFixture();f.overlay.onPressedMoveStart({overlay:f.overlay});
  f.update({...f.current,price:2002});
  f.overlay.onPressedMoveEnd({chart:f.chart,overlay:f.overlay});
  assert.deepEqual(f.moves,[]);
  assert.equal(f.overlay.points[0].value,2002);
});
