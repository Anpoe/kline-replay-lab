import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMt4Protection } from '../app/features/mt4/mt4Protection.mjs';
const order={ticket:42,symbol:'XAUUSD',type:0,openTime:100,closeTime:0,stopLoss:1990,takeProfit:2030};
const state={accountKey:'account-a',connection:'connected',enabled:true,unresolved:0,snapshot:{account:{connected:true,tradeAllowed:true},orders:[order]}};
const edit={accountKey:'account-a',order:{...order},field:'stopLoss'};
const input={state,edit,id:'protection-1',values:{stopLoss:'1992.50',takeProfit:'2040'}};

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
