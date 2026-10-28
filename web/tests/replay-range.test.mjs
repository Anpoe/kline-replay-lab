import assert from 'node:assert/strict';
import test from 'node:test';
import { replayRangeEndIndex, randomReplayPairs } from '../app/lib/replayRange.ts';
import { rebaseReplayTaskToFinerBars, remapReplayDrawingPoints, replayTimeframeEnd } from '../app/lib/timeframeView.ts';
import { advanceReplayCursor } from '../app/lib/replayTradingSession.ts';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { tradingDate } from '../app/lib/marketRules.ts';

test('the snapshot route returns the complete chosen date span and an unlimited remaining span', async () => {
  const source = await readFile(new URL('../app/api/snapshots/route.ts', import.meta.url),'utf8');
  const ast = ts.createSourceFile('route.ts',source,ts.ScriptTarget.Latest,true);
  const names = new Set(['selectLocalReplayWindow','boundedInteger','validDateKey']);
  const functions = ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.has(node.name?.text)).map(node=>node.getText(ast)).join('\n');
  const js = ts.transpileModule(functions,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const select = new Function('replayRangeEndIndex','tradingDate',js+'; return selectLocalReplayWindow;')(replayRangeEndIndex,tradingDate);
  const start = Date.parse('2026-01-01T00:00:00Z');
  const bars = Array.from({length:30_000},(_,index)=>({timestamp:start+index*60_000}));
  const dated = select(bars,'UTC',{mode:'range',startDate:'2026-01-01',endDate:'2026-01-10'});
  assert.equal(dated.selection.sourceEndIndex,14_399);
  assert.equal(dated.selection.truncated,false);
  const all = select(bars,'UTC',{mode:'free',startMode:'bar',startBar:101,length:0});
  assert.equal(all.selection.sourceEndIndex,29_999);
  assert.equal(all.selection.truncated,false);
});

test('unlimited replay and explicit ranges continue beyond 5000 and 10000 candles', () => {
  assert.equal(replayRangeEndIndex(100, 30_000, 0), 30_000);
  assert.equal(replayRangeEndIndex(100, 30_000, 20_000), 20_100);
  assert.equal(replayRangeEndIndex(100, 30_000, 0, 25_000), 25_000);
  assert.equal(replayRangeEndIndex(100, 30_000, 30, 25_000), 25_000);
  assert.equal(replayRangeEndIndex(100, 30_000, 100_000), 30_000);
});

test('an explicit unlimited random draft is not replaced by the saved finite default', async () => {
  const source=await readFile(new URL('../app/components/TrainingWorkbench.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/draft\.length > 0 \? draft\.length : randomConfig\.length/);
});

test('random replay retains fixed, current and random period rules without leaving the requested scope', () => {
  const instruments = [{id:'FX',timeframes:['1m','1h']}, {id:'STOCK',timeframes:['1d']}];
  assert.deepEqual(randomReplayPairs(instruments,'fixed','1d','1h').map(p=>[p.instrument.id,p.timeframe]), [['FX','1h']]);
  assert.deepEqual(randomReplayPairs(instruments,'current','1m','1h').map(p=>[p.instrument.id,p.timeframe]), [['FX','1m']]);
  assert.ok(randomReplayPairs(instruments,'all','1m','1h').some(p=>p.instrument.id==='STOCK'&&p.timeframe==='1d'));
});

test('an hourly random task can switch to M1 and advance exactly one minute', () => {
  const start=Date.parse('2026-10-20T10:00:00Z');
  const bars=Array.from({length:240},(_,index)=>({timestamp:start+index*60_000}));
  const task={version:1,mode:'free',startCursor:0,startTimestamp:start,endCursor:2,endTimestamp:start+120*60_000,
    requestedLength:2,status:'active',hideInstrument:false,hideDate:false,hidePrice:false,randomRun:true};
  const mapped=rebaseReplayTaskToFinerBars(task,bars,'1h','UTC',false);
  assert.equal(mapped.startCursor,59);
  assert.equal(mapped.endCursor,179);
  assert.equal(advanceReplayCursor({bars,cursor:mapped.startCursor,endCursor:mapped.endCursor,requestedCount:1,timeframe:'1m',timezone:'UTC',randomRun:true}),60);
  assert.equal(task.startCursor,0);
  assert.throws(()=>rebaseReplayTaskToFinerBars(task,bars.slice(120),'1h','UTC',false),/缺少/);
});

test('calendar and FX close boundaries respect actual month lengths and DST', () => {
  assert.equal(replayTimeframeEnd(Date.parse('2026-02-15T00:00:00Z'),'1mo','UTC',false),Date.parse('2026-03-01T00:00:00Z'));
  assert.equal(replayTimeframeEnd(Date.parse('2026-03-07T22:00:00Z'),'1d','America/New_York',true),Date.parse('2026-03-08T21:00:00Z'));
});

test('drawing coordinates adapt across chart periods without mutating persisted points', () => {
  const minute=Array.from({length:20},(_,index)=>({timestamp:1000+index*60000}));
  const five=[minute[0],minute[5],minute[10],minute[15]];
  const original={id:'line',points:[{timestamp:minute[7].timestamp,dataIndex:107,value:1.1},{dataIndex:115,value:1.2}]};
  const display=remapReplayDrawingPoints(original,minute,five,100);
  assert.deepEqual(display.points,[{timestamp:minute[5].timestamp,dataIndex:1,value:1.1},{timestamp:minute[15].timestamp,dataIndex:3,value:1.2}]);
  assert.deepEqual(remapReplayDrawingPoints(display,five,minute,0,100).points.map(p=>p.dataIndex),[105,115]);
  assert.equal(original.points[0].timestamp,minute[7].timestamp);
  assert.equal(original.points[1].timestamp,undefined);
});
