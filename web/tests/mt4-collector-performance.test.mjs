import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../public/mt4/KLineTradeBridge.mq4',import.meta.url),'utf8');
// Execute the actual collector's small MQL subset against terminal doubles. Native compilation checks the full EA.
function collector(name,api){
  const start=source.indexOf(' '+name+'('),open=source.indexOf('{',start),end=source.indexOf('\n}',open);
  const parameters=source.slice(source.indexOf('(',start)+1,source.indexOf(')',start)).replace(/\b(string|int|uint|bool)\s*&?/g,'').replace(/\[\]/g,'');
  let body=source.slice(open+1,end),state='';
  body=body.replace(/static (?:string|int|uint) ([^;]+);/g,(_,decl)=>{state+='var '+decl.replace(/(\w+)\[\]/g,'$1=[]')+';';return '';});
  body=body.replace(/\b(?:MqlRates|string|datetime|int|uint|bool)\s+(\w+)\[(\d*)\];/g,(_,name,size)=>'var '+name+'=Array('+(size||0)+').fill(0);');
  body=body.replace(/\((?:long|uint|int|bool)\)/g,'').replace(/\b(?:string|datetime|int|uint|bool)\s+/g,'var ');
  return new Function('api','with(api){'+state+'return function('+parameters+'){'+body+'};}')(api);
}
function terminal(){
  const state={now:100,login:1,server:'broker',watch:Array.from({length:115},(_,i)=>'S'+i),orders:[],selectedSymbol:'S0',selected:new Set(),nativeSelections:0,rows:[],history:[],historyReads:0,revision:1};
  state.watch.forEach(s=>state.selected.add(s));
  const api={GetTickCount:()=>state.now,AccountNumber:()=>state.login,AccountServer:()=>state.server,Mode:()=> 'demo',IntegerToString:String,StringLen:s=>s.length,ArraySize:a=>a.length,ArrayResize:(a,n)=>{a.length=n;},ArrayInitialize:(a,n)=>a.fill(n),MathMin:Math.min,
    SafeSymbol:s=>typeof s==='string'&&s.length>0,SymbolInfoInteger:s=>state.selected.has(s),SYMBOL_SELECT:1,SymbolSelect:s=>{state.nativeSelections++;state.selected.add(s);return true;},
    OrdersTotal:()=>state.orders.length,OrdersHistoryTotal:()=>state.history.length,SELECT_BY_POS:0,SELECT_BY_TICKET:1,MODE_TRADES:0,MODE_HISTORY:1,OP_SELLSTOP:5,
    OrderSelect:(i,by,pool)=>{state.current=by===1?[...state.history,...state.orders].find(o=>o.ticket===i):(pool===1?(state.historyReads++,state.history[i]):state.orders[i]);return !!state.current;},
    OrderSymbol:()=>state.current.symbol,OrderType:()=>state.current.type,OrderTicket:()=>state.current.ticket,OrderCloseTime:()=>state.current.closeTime,OrderJson:()=>JSON.stringify(state.current),
    SymbolsTotal:()=>state.watch.length,SymbolName:i=>state.watch[i],
    get selectedSymbol(){return state.selectedSymbol;},
    SymbolJson:s=>{if(!api.EnsureSelected(s))return '';state.rows.push(s);return JSON.stringify({symbol:s,quoteRevision:state.revision});}
  };
  for(const name of ['EnsureSelected','FindSymbolName','AddSymbolName','SymbolsJson','OrdersJson'])api[name]=collector(name,api);
  return {state,api};
}
test('warm heartbeat refreshes selected/order quotes without rewriting the Market Watch or rebuilding 115 rows',()=>{
  const {state,api}=terminal();state.orders=[{symbol:'S1'},{symbol:'S2'}];
  assert.equal(JSON.parse(api.SymbolsJson()).length,115);assert.equal(state.rows.length,115);assert.equal(state.nativeSelections,0);
  state.rows=[];state.now+=1000;state.revision++;
  const rows=JSON.parse(api.SymbolsJson());assert.equal(rows.length,115);assert.deepEqual(state.rows,['S0','S1','S2']);
  assert.equal(rows.find(r=>r.symbol==='S0').quoteRevision,2);assert.equal(rows.find(r=>r.symbol==='S2').quoteRevision,2);assert.equal(rows.find(r=>r.symbol==='S3').quoteRevision,1);assert.equal(state.nativeSelections,0);
});
test('selection, catalogue changes, account changes and expiry invalidate only the appropriate cached context',()=>{
  const {state,api}=terminal();api.SymbolsJson();state.rows=[];state.selectedSymbol='S114';state.now+=1000;state.revision=2;
  assert.equal(JSON.parse(api.SymbolsJson()).find(r=>r.symbol==='S114').quoteRevision,2);assert.deepEqual(state.rows,['S114']);
  state.orders=[{symbol:'NEW'}];state.rows=[];assert.ok(JSON.parse(api.SymbolsJson()).some(r=>r.symbol==='NEW'));assert.equal(state.nativeSelections,1);
  api.SymbolsJson();assert.equal(state.nativeSelections,1);
  state.login=2;state.revision=3;assert.ok(JSON.parse(api.SymbolsJson()).every(r=>r.quoteRevision===3));
  state.revision=4;state.now+=10000;assert.ok(JSON.parse(api.SymbolsJson()).every(r=>r.quoteRevision===4));
  state.watch.push('ADDED');assert.ok(JSON.parse(api.SymbolsJson()).some(r=>r.symbol==='ADDED'));
});
test('selected symbol and held instruments retain priority when the catalogue exceeds the 300-symbol protocol bound',()=>{
  const {state,api}=terminal();state.watch=Array.from({length:400},(_,i)=>'S'+i);state.selectedSymbol='S399';state.orders=[{symbol:'HELD'}];
  const rows=JSON.parse(api.SymbolsJson());assert.equal(rows.length,300);assert.equal(rows[0].symbol,'S399');assert.equal(rows[1].symbol,'HELD');assert.equal(new Set(rows.map(r=>r.symbol)).size,300);
});
test('recent history rescans immediately for new closes and account changes, with bounded refresh for corrections',()=>{
  const {state,api}=terminal();state.history=[{ticket:1,type:0,closeTime:100,symbol:'S0',profit:1}];
  assert.equal(JSON.parse(api.OrdersJson(true))[0].profit,1);state.historyReads=0;state.now+=1000;api.OrdersJson(true);assert.equal(state.historyReads,0);
  state.history.push({ticket:2,type:1,closeTime:200,symbol:'S1'});assert.equal(JSON.parse(api.OrdersJson(true))[0].ticket,2);
  state.history[1].profit=20;state.now+=10000;assert.equal(JSON.parse(api.OrdersJson(true))[0].profit,20);
  state.login=2;state.history=[{ticket:3,type:0,closeTime:100,symbol:'S0'}];assert.equal(JSON.parse(api.OrdersJson(true))[0].ticket,3);
});

test('merged collector is generated from the same standalone hot-path logic',async()=>{
  const embedded=(await readFile(new URL('../public/mt4/KLineTrainingBridge.mqh',import.meta.url),'utf8')).replace(/\bKLC_(\w+)/g,'$1');
  const body=(text,name)=>{const start=text.indexOf(' '+name+'('),open=text.indexOf('{',start);return text.slice(open,text.indexOf('\n}',open)+2);};
  for(const name of ['EnsureSelected','FindSymbolName','AddSymbolName','SymbolsJson','HotSymbolsJson','BarsJson','SnapshotJson','OrdersJson','RecordCycleTiming'])assert.equal(body(embedded,name),body(source,name));
});

test('lightweight quote collector touches only selected and held symbols, not the full catalogue',()=>{
 const {state,api}=terminal();api.HotSymbolsJson=collector('HotSymbolsJson',api);state.orders=[{symbol:'S1'}];
 assert.deepEqual(JSON.parse(api.HotSymbolsJson()).map(r=>r.symbol),['S0','S1']);assert.deepEqual(state.rows,['S0','S1']);assert.equal(state.nativeSelections,0);
});
test('native bar collector requests two real rates on the fast path and preserves all OHLCV fields',()=>{
 const requested=[];const rates=Array.from({length:300},(_,i)=>({time:1000+i*300,open:2,high:3,low:1,close:2.2,tick_volume:i}));
 const api={selectedSymbol:'S0',selectedTimeframe:5,CopyRates:(s,tf,start,limit,target)=>{requested.push(limit);target.push(...rates.slice(-limit));return target.length;},IntegerToString:String,N:String};
 const bars=collector('BarsJson',api);assert.equal(JSON.parse(bars()).length,300);const fast=JSON.parse(bars(2));assert.deepEqual(requested,[300,2]);assert.deepEqual(fast,rates.slice(-2).map(r=>({timestamp:r.time*1000,open:r.open,high:r.high,low:r.low,close:r.close,volume:r.tick_volume})));
});
