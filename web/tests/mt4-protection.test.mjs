import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMt4Protection } from '../app/features/mt4/mt4Protection.mjs';
import * as protection from '../app/features/mt4/mt4Protection.mjs';
const order={ticket:42,symbol:'XAUUSD',type:0,openTime:100,closeTime:0,stopLoss:1990,takeProfit:2030};
const state={accountKey:'account-a',connection:'connected',enabled:true,unresolved:0,snapshot:{account:{connected:true,tradeAllowed:true},orders:[order]}};
const edit={accountKey:'account-a',order:{...order},field:'stopLoss'};
const input={state,edit,id:'protection-1',values:{stopLoss:'1992.50',takeProfit:'2040'}};

const dragOrder={...order,openPrice:2000,lots:.1};
const dragState={...state,selection:{symbol:'XAUUSD',timeframe:15},snapshot:{...state.snapshot,capturedAt:1000,chart:{symbol:'XAUUSD'},symbols:[{symbol:'XAUUSD',digits:2,bid:2001,ask:2002,quoteTime:1000}],orders:[dragOrder]}};
const lines=(current=dragState,options={})=>protection.deriveMt4OrderProtectionLines({state:current,symbol:'XAUUSD',timestamp:1000000,digits:2,movable:true,...options});

test('active orders have bound entry and protection lines independent from historical markers',()=>{
  const others=[dragOrder,{...dragOrder,ticket:43,type:3},{...dragOrder,ticket:44,symbol:'EURUSD'},{...dragOrder,ticket:45,closeTime:200}];
  const result=lines({...dragState,snapshot:{...dragState.snapshot,orders:others}});
  assert.equal(result.length,6);
  assert.deepEqual(result.map(line=>line.field),['entry','stopLoss','takeProfit','entry','stopLoss','takeProfit']);
  assert.ok(result.every(line=>line.accountKey==='account-a'&&line.source==='position'&&line.movable));
  assert.equal(result[0].price,2000);assert.match(result[0].label,/#42/);
  assert.notEqual(result[0].id,result[3].id);
  assert.deepEqual(lines(null),[]);
});

test('dragging an existing protection line changes only that order/field and preserves the latest opposite side',()=>{
  const line=lines().find(line=>line.field==='stopLoss');
  const current={...dragState,snapshot:{...dragState.snapshot,orders:[{...dragOrder,takeProfit:2050}]}};
  const command=protection.prepareMt4ProtectionDrag({state:current,line,price:1992.567,id:'drag-one'});
  assert.deepEqual(command,{id:'drag-one',accountKey:'account-a',type:'protect',symbol:'XAUUSD',ticket:42,stopLoss:1992.57,takeProfit:2050});
  assert.equal(line.order.stopLoss,1990);assert.equal(dragOrder.takeProfit,2030);
  assert.equal(protection.prepareMt4ProtectionDrag({state:dragState,line,price:1990,id:'unchanged'}),null);
});

test('dragging an entry line creates the appropriate protection for buys, sells and pending orders without moving entry',()=>{
  for(const type of [0,1,2,3,4,5]){
    const current={...dragState,snapshot:{...dragState.snapshot,orders:[{...dragOrder,type,stopLoss:0,takeProfit:0}]}};
    const line=lines(current)[0];
    for(const price of [1990,2030]){
      const command=protection.prepareMt4ProtectionDrag({state:current,line,price,id:'drag-entry'});
      const buy=[0,2,4].includes(type),stop=buy?price<2000:price>2000;
      assert.equal(command[stop?'stopLoss':'takeProfit'],price);
      assert.equal(command[stop?'takeProfit':'stopLoss'],0);
      assert.equal(command.type,'protect');assert.equal(command.price,undefined);
    }
    assert.equal(protection.prepareMt4ProtectionDrag({state:current,line,price:2000,id:'noop'}),null);
  }
  const profitable={...dragState,snapshot:{...dragState.snapshot,symbols:[{...dragState.snapshot.symbols[0],bid:2020,ask:2021}]}};
  const command=protection.prepareMt4ProtectionDrag({state:profitable,line:lines(profitable)[0],price:2010,id:'profit-stop'});
  assert.equal(command.stopLoss,2010);assert.equal(command.takeProfit,2030);
});

test('drag protection rejects stale bindings, unavailable quotes, disabled orders and changed chart/account',()=>{
  const line=lines().find(line=>line.field==='stopLoss');
  for(const change of [{accountKey:'account-b'},{enabled:false},{connection:'offline'},{unresolved:1},{selection:{symbol:'EURUSD',timeframe:15}}]){
    assert.throws(()=>protection.prepareMt4ProtectionDrag({state:{...dragState,...change},line,price:1992,id:'blocked'}));
  }
  for(const change of [{stopLoss:1991},{openTime:101},{type:1},{closeTime:200}])assert.throws(()=>protection.prepareMt4ProtectionDrag({state:{...dragState,snapshot:{...dragState.snapshot,orders:[{...dragOrder,...change}]}},line,price:1992,id:'stale'}));
  const entry=lines()[0];
  assert.throws(()=>protection.prepareMt4ProtectionDrag({state:{...dragState,snapshot:{...dragState.snapshot,symbols:[{...dragState.snapshot.symbols[0],quoteTime:1}]}},line:entry,price:1992,id:'stale-quote'}),/报价/);
  assert.throws(()=>protection.prepareMt4ProtectionDrag({state:dragState,line:{...line,movable:false},price:1992,id:'locked'}));
  for(const price of [0,-1,NaN,Infinity])assert.throws(()=>protection.prepareMt4ProtectionDrag({state:dragState,line,price,id:'invalid'}));
});

test('pending drags show the proposed level as awaiting confirmation, then rejection restores the terminal level',()=>{
  const pending={id:'pending',type:'protect',accountKey:'account-a',symbol:'XAUUSD',ticket:42,stopLoss:1992,takeProfit:2030,status:'sent'};
  const proposed=lines(dragState,{movable:false,pending});
  const stop=proposed.find(line=>line.field==='stopLoss');
  assert.equal(stop.price,1992);assert.equal(stop.movable,false);assert.match(stop.label,/等待确认/);
  const rejected=lines(dragState,{pending:{...pending,status:'failed'}}).find(line=>line.field==='stopLoss');
  assert.equal(rejected.price,1990);assert.doesNotMatch(rejected.label,/等待确认/);
});

test('single-field edits preserve the latest protection on the other side',()=>{
  const current={...order,takeProfit:2050};
  const next=prepareMt4Protection({...input,state:{...state,snapshot:{...state.snapshot,orders:[current]}}});
  assert.deepEqual(next,{id:'protection-1',accountKey:'account-a',type:'protect',symbol:'XAUUSD',ticket:42,stopLoss:1992.5,takeProfit:2050});
  const target=prepareMt4Protection({...input,edit:{...edit,field:'takeProfit'}});
  assert.equal(target.stopLoss,1990);assert.equal(target.takeProfit,2040);
  assert.deepEqual(order,{ticket:42,symbol:'XAUUSD',type:0,openTime:100,closeTime:0,stopLoss:1990,takeProfit:2030});
});
test('clear controls remove only the named protection, including the combined editor',()=>{
  const stop=prepareMt4Protection({...input,edit:{...edit,field:'both'},remove:'stopLoss'});
  assert.equal(stop.stopLoss,0);assert.equal(stop.takeProfit,2030);
  const target=prepareMt4Protection({...input,edit:{...edit,field:'both'},remove:'takeProfit'});
  assert.equal(target.stopLoss,1990);assert.equal(target.takeProfit,0);
  const empty=prepareMt4Protection({...input,values:{...input.values,stopLoss:''}});
  assert.equal(empty.stopLoss,0);assert.equal(empty.takeProfit,2030);
});
test('unset protection can be added; unchanged protection produces no command',()=>{
  const unset={...order,takeProfit:0};
  const next=prepareMt4Protection({...input,state:{...state,snapshot:{...state.snapshot,orders:[unset]}},edit:{...edit,order:unset,field:'takeProfit'}});
  assert.equal(next.takeProfit,2040);assert.equal(next.stopLoss,1990);
  assert.equal(prepareMt4Protection({...input,values:{...input.values,stopLoss:'1990'}}),null);
});
test('rejects account changes, vanished or replaced tickets and terminal disablement',()=>{
  assert.throws(()=>prepareMt4Protection({...input,state:{...state,accountKey:'account-b'}}),/账户已变化/);
  for(const orders of [[],[{...order,symbol:'EURUSD'}],[{...order,openTime:101}],[{...order,closeTime:200}],[{...order,type:2}]]){
    assert.throws(()=>prepareMt4Protection({...input,state:{...state,snapshot:{...state.snapshot,orders}}}),/订单已变化/);
  }
  for(const change of [{enabled:false},{connection:'offline'},{unresolved:1},{snapshot:{...state.snapshot,account:{connected:false,tradeAllowed:true}}},{snapshot:{...state.snapshot,account:{connected:true,tradeAllowed:false}}}]){
    assert.throws(()=>prepareMt4Protection({...input,state:{...state,...change}}),/连接|权限|未完成/);
  }
});
test('requires rereading if the field being edited changed in MT4',()=>{
  assert.throws(()=>prepareMt4Protection({...input,state:{...state,snapshot:{...state.snapshot,orders:[{...order,stopLoss:1991}]}}}),/已在 MT4 更新/);
  assert.throws(()=>prepareMt4Protection({...input,edit:{...edit,field:'both'},state:{...state,snapshot:{...state.snapshot,orders:[{...order,takeProfit:2050}]}}}),/已在 MT4 更新/);
});
test('validates only edited fields and retains combined editing',()=>{
  for(const value of ['-1','NaN','Infinity','abc'])assert.throws(()=>prepareMt4Protection({...input,values:{...input.values,stopLoss:value}}),/有效/);
  assert.equal(prepareMt4Protection({...input,values:{...input.values,takeProfit:'unused'}}).stopLoss,1992.5);
  const both=prepareMt4Protection({...input,edit:{...edit,field:'both'}});assert.equal(both.stopLoss,1992.5);assert.equal(both.takeProfit,2040);
});
