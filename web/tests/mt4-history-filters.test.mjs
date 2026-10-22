import test from 'node:test';
import assert from 'node:assert/strict';
import { dateRangeBounds, readHistoryPreferences, rememberHistoryFilter, restoreHistorySelection, buildMt4HistoryMarkers } from '../app/lib/mt4History.mjs';

test('MT4 calendar dates include both boundary days, independent of local timezone', () => {
  assert.deepEqual(dateRangeBounds('2026-10-01','2026-10-15'), { start: Date.UTC(2026,9,1)/1000, end: Date.UTC(2026,9,16)/1000 });
  assert.deepEqual(dateRangeBounds('',''), { start: null, end: null });
  assert.throws(() => dateRangeBounds('2026-02-30',''), /日期/);
  assert.throws(() => dateRangeBounds('2026-10-16','2026-10-15'), /开始/);
});
test('remembers filters independently per account and restores the last account', () => {
  let p = readHistoryPreferences(null), a='a'.repeat(64),b='b'.repeat(64);
  p=rememberHistoryFilter(p,a,{symbol:'XAUUSD.a',from:'2026-10-01',to:'2026-10-15',showOnChart:true});
  p=rememberHistoryFilter(p,b,{symbol:'EURUSD',from:'',to:'',showOnChart:false});
  const restored=readHistoryPreferences(JSON.stringify(p));
  assert.equal(restored.accountKey,b);assert.equal(restored.accounts[a].symbol,'XAUUSD.a');assert.equal(restored.accounts[b].showOnChart,false);
  assert.equal(readHistoryPreferences('broken').accountKey,'');
});
test('plots executions on their containing candle, never the nearer future candle or a gap', () => {
  const base=Date.UTC(2026,9,15,12), bars=[0,15,45].map(min=>({timestamp:base+min*60000}));
  const o={ticket:7,symbol:'XAUUSD',type:0,lots:.1,openTime:(base+14*60000)/1000,closeTime:(base+29*60000)/1000,openPrice:2000,closePrice:2010,profit:10,swap:0,commission:-1};
  let marks=buildMt4HistoryMarkers([o],bars,15,'a'.repeat(64));
  assert.equal(marks.length,1);assert.equal(marks[0].entryPlotTimestamp,base);assert.equal(marks[0].exitPlotTimestamp,base+15*60000);
  marks=buildMt4HistoryMarkers([{...o,openTime:(base+35*60000)/1000,closeTime:(base+46*60000)/1000}],bars,15,'a'.repeat(64));
  assert.equal(marks.length,1);assert.equal(marks[0].eventKind,'exit');assert.equal(marks[0].entryPlotTimestamp,base+45*60000);
  assert.equal(buildMt4HistoryMarkers([{...o,type:2}],bars,15,'a'.repeat(64)).length,0);
});

test('initial history restoration waits for account status and does not misclassify live startup as history', () => {
  const a='a'.repeat(64), b='b'.repeat(64), accounts=[{accountKey:a},{accountKey:b}];
  const fresh=readHistoryPreferences(null);
  assert.equal(restoreHistorySelection(fresh,accounts,'',false),null);
  assert.equal(restoreHistorySelection(fresh,accounts,a,false),null);
  assert.deepEqual(restoreHistorySelection(fresh,accounts,a,true),{accountKey:a,filter:{symbol:'',from:'',to:'',showOnChart:true}});
  assert.equal(restoreHistorySelection(fresh,[],a,true),null);
  const remembered=rememberHistoryFilter(fresh,b,{symbol:'',from:'',to:'',showOnChart:true});
  assert.equal(restoreHistorySelection(remembered,accounts,'',false),null);
  assert.deepEqual(restoreHistorySelection(remembered,accounts,a,true),{accountKey:b,filter:remembered.accounts[b]});
  assert.deepEqual(restoreHistorySelection(remembered,accounts,b,true),{accountKey:b,filter:remembered.accounts[b]});
  const dated=rememberHistoryFilter(fresh,a,{symbol:'XAUUSD',from:'2026-10-01',to:'2026-10-15',showOnChart:true});
  const restored=restoreHistorySelection(dated,accounts,a,true);
  assert.deepEqual(restored,{accountKey:a,filter:dated.accounts[a]});
  assert.equal(Object.hasOwn(restored,'navigate'),false,'Restoring preferences must not request historical chart navigation');
});
