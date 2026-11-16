import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { rectangleOverlay, rectangleControlPoints } from '../app/lib/rectangleDrawing.ts';
import { drawingVisualStyles } from '../app/lib/drawingStyles.ts';

const anchors = [{ timestamp: 1000, dataIndex: 1, value: 100 }, { timestamp: 4000, dataIndex: 4, value: 80 }];
test('two saved diagonal anchors expose four native resize handles without changing the saved format', () => {
  const points = rectangleControlPoints(anchors);
  assert.deepEqual(points.map(p => [p.dataIndex, p.value]), [[1,100],[4,80],[4,100],[1,80]]);
  assert.deepEqual(anchors, points.slice(0,2));
  const path = '../app/components/KLineReplayChart.tsx';
  const parsed = ts.createSourceFile(path,readFileSync(new URL(path,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const serialize = parsed.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='serializeDrawing').getText(parsed);
  const fn = new Function(ts.transpileModule(serialize+'\nreturn serializeDrawing;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)();
  const saved = fn({name:'trainingRectangle',points,styles:{},extendData:{}},10);
  assert.deepEqual(saved.points, anchors.map(p=>({...p,dataIndex:p.dataIndex+10})));
});

for (const index of [0,1,2,3]) test(`corner ${index} moves both axes and leaves its opposite corner fixed even when crossing`, () => {
  const points = rectangleControlPoints(anchors), opposite = structuredClone(points[[1,0,3,2][index]]);
  const performPoint = {timestamp:6000,dataIndex:6,value:120};
  points[index] = {...performPoint}; // Native chart moves the selected handle before the template callback.
  rectangleOverlay.performEventPressedMove({points,performPointIndex:index,performPoint});
  assert.deepEqual(points[index],performPoint);
  assert.deepEqual(points[[1,0,3,2][index]],opposite);
  assert.deepEqual(points,rectangleControlPoints(points.slice(0,2)));
});

test('initial placement builds all corners and borderless rectangles retain fill and hit area', () => {
  const points=structuredClone(anchors);
  rectangleOverlay.performEventMoveForDrawing({points});assert.equal(points.length,4);
  const styles=drawingVisualStyles({line:{size:3},rect:{borderSize:2}},'#ef6a68',0);
  const [figure]=rectangleOverlay.createPointFigures({overlay:{styles,currentStep:-1},coordinates:[{x:40,y:10},{x:10,y:50}]});
  assert.equal(figure.styles.style,'fill');assert.equal(figure.styles.borderSize,0);assert.equal(figure.styles.color,'#ef6a6838');
  assert.deepEqual(figure.attrs,{x:10,y:10,width:30,height:40});assert.notEqual(figure.ignoreEvent,true);
  const recolored=drawingVisualStyles(styles,'#20c997',0);assert.equal(recolored.rect.borderSize,0);assert.equal(recolored.line.size,3);
  assert.equal(drawingVisualStyles(recolored,'#20c997',2).rect.borderSize,2);
});

const chartSource=readFileSync(new URL('../app/components/KLineReplayChart.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('chart.tsx',chartSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let effect;
const visit=node=>{if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('const createNext ='))effect=node.arguments[0].getText(ast);ts.forEachChild(node,visit);};visit(ast);
function drawingSession() {
  const overlays=[],saved=[],selected=[],microtasks=[];let cancelled=0;
  const chart={
    createOverlay(options){const overlay={...options,id:String(overlays.length),currentStep:1,points:[]};overlays.push(overlay);return overlay.id;},
    getOverlays:()=>overlays.filter(o=>!o.removed),overrideOverlay(){},
    removeOverlay({id}){const o=overlays.find(o=>o.id===id&&!o.removed);if(o){o.removed=true;o.onRemoved({chart,overlay:o});}},
  };
  const context={USER_DRAWING_GROUP:'drawings',drawingKey:'trainingRectangle:1',chartRef:{current:chart},drawingRequestRef:{current:{name:'trainingRectangle',nonce:1}},
    setDrawingInteraction:value=>context.active=value,onDrawingCancelRef:{current:()=>cancelled++},rememberDrawingContext(){},
    enableTextBoxFreeMovement(){},syncTrainingTextBoxScale(){},selectedTrainingTextId:'',suppressDrawingEventsRef:{current:false},dataIndexOffsetRef:{current:0},
    onDrawingsChangeRef:{current:value=>saved.push(value)},onDrawingSelectRef:{current:value=>selected.push(value)},
    getPersistedDrawings:chart=>chart.getOverlays().filter(o=>o.currentStep===-1).map(o=>o.id),queueMicrotask:fn=>microtasks.push(fn)};
  const cleanup=new Function('context',`with(context){return (${ts.transpileModule(effect,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText.trim().replace(/;$/,'')})();}`)(context);
  const flush=()=>{while(microtasks.length)microtasks.shift()();};
  const complete=()=>{const o=overlays.at(-1);o.currentStep=-1;o.onDrawEnd({chart,overlay:o});flush();};
  return {context,overlays,saved,selected,chart,complete,flush,cleanup,cancelled:()=>cancelled};
}

test('finishing successive drawings keeps the tool active, while right-cancel exits and keeps completed drawings',()=>{
  const f=drawingSession();f.complete();f.complete();
  assert.equal(f.context.active,true);assert.equal(f.overlays.length,3);assert.deepEqual(f.saved,[['0'],['0','1']]);
  f.chart.removeOverlay({id:'2'});f.flush();assert.equal(f.cancelled(),1);assert.equal(f.context.active,false);
  assert.equal(f.overlays.filter(o=>!o.removed).length,2);f.cleanup();f.flush();assert.equal(f.overlays.length,3);
});

test('deleting an older finished object does not cancel the next drawing; switching to cursor removes only the unfinished one',()=>{
  const f=drawingSession();f.complete();f.chart.removeOverlay({id:'0'});f.flush();
  assert.equal(f.context.active,true);assert.equal(f.cancelled(),0);f.cleanup();f.flush();
  assert.equal(f.overlays.filter(o=>!o.removed).length,0);assert.equal(f.cancelled(),0);
});

test('cancelling before the next queued drawing is created cannot resurrect a tool',()=>{
  const f=drawingSession(),first=f.overlays[0];first.currentStep=-1;first.onDrawEnd({chart:f.chart,overlay:first});
  f.cleanup();f.flush();assert.equal(f.overlays.length,1);assert.equal(first.removed,undefined);
});

test('unmounting a chart does not persist its cleared canvas over saved drawings',()=>{
  const f=drawingSession();f.complete();
  f.overlays[0].removed=true; // The chart destroys its completed-overlay cache before effect cleanup.
  const savedCount=f.saved.length;f.cleanup();f.flush();
  assert.equal(f.saved.length,savedCount,'discarding the temporary overlay must not emit a data change');
  assert.deepEqual(f.saved.at(-1),['0']);
});
