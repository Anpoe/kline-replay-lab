import test from "node:test";
import assert from "node:assert/strict";
import { captureCloseAllPlan, runCloseAll } from "../app/features/mt4/mt4CloseAll.ts";
import { Mt4Bridge } from "../local-data/mt4-bridge.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const position = (ticket, symbol = "XAUUSD") => ({ ticket, symbol, type: ticket % 2, lots: .05, openTime: 100, openPrice: 4000, stopLoss: 0, takeProfit: 0, profit: 0, swap: 0, commission: 0, closeTime: 0, closePrice: 0, magic: 1 });
function fixture() {
  const state = { protocolVersion: 1, accountKey: "account", enabled: true, connection: "connected", unresolved: 0, lastSeen: Date.now(), selection: {symbol:"XAUUSD",timeframe:5},commands: [], snapshot: { sessionId: "session", orderCount: 4, orders: [position(1), position(2, "EURUSD"), position(3), { ...position(4), type: 2 }], account: {login:"123",server:"demo",mode:"demo",connected:true,tradeAllowed:true,allowReal:false},symbols: [] } };
  let id = 0; const posts = []; const progress = [];
  const request = async payload => {
    if (payload) {
      assert.equal(state.unresolved, 0, "never send overlapping commands"); posts.push(payload.command);
      state.commands.unshift({...payload.command,login:state.snapshot.account.login,server:state.snapshot.account.server,mode:state.snapshot.account.mode,status:"queued"});state.unresolved = 1;
    } else if (state.unresolved) {
      const c=state.commands[0];c.status="succeeded";state.unresolved=0;
      state.snapshot.orders=state.snapshot.orders.filter(o=>o.ticket!==c.ticket);state.snapshot.orderCount=state.snapshot.orders.length;
    }
    return structuredClone(state);
  };
  return {state,posts,progress,request, options: {request, commandId:()=>`command-${++id}`, wait:async()=>{}, onProgress:p=>progress.push(p)} };
}
test("captures all account market positions, preserving pending orders and identity", () => {
  const f=fixture(),plan=captureCloseAllPlan(f.state);
  assert.deepEqual(plan.positions.map(p=>p.ticket),[1,2,3]);assert.equal(plan.sessionId,"session");
  f.state.snapshot.orderCount=5;assert.throws(()=>captureCloseAllPlan(f.state),/完整/);
  f.state.snapshot.orderCount=4;f.state.enabled=false;assert.throws(()=>captureCloseAllPlan(f.state),/开启/);
});
test("closes sequentially only after receipts and removal from positions", async () => {
  const f=fixture(),plan=captureCloseAllPlan(f.state),result=await runCloseAll(plan,20,f.options);
  assert.equal(result.outcome,"complete");assert.equal(result.closed,3);assert.equal(result.remaining,0);
  assert.deepEqual(f.posts.map(p=>p.ticket),[1,2,3]);assert.equal(new Set(f.posts.map(p=>p.id)).size,3);
  assert.ok(f.posts.every(p=>p.type==="close"&&p.slippage===20));assert.deepEqual(f.state.snapshot.orders.map(p=>p.ticket),[4]);
});
test("refuses changed confirmation, account, session and real-account permission", async () => {
  for(const mutate of [s=>s.snapshot.orders[0].lots=.02,s=>s.accountKey="other",s=>s.snapshot.sessionId="other",s=>{s.snapshot.account.mode="real";s.snapshot.account.allowReal=false;}]){
    const f=fixture(),plan=captureCloseAllPlan(f.state);mutate(f.state);
    const result=await runCloseAll(plan,20,f.options);assert.equal(result.outcome,"stopped");assert.equal(f.posts.length,0);
  }
});
test("stops on broker rejection without sending later positions", async () => {
  const f=fixture(),plan=captureCloseAllPlan(f.state);
  const request=async payload=>{const next=await f.request(payload);if(!payload&&f.posts.length===2){next.commands[0].status="failed";next.commands[0].error="broker reject";}return next;};
  const result=await runCloseAll(plan,20,{...f.options,request});assert.equal(result.closed,1);assert.equal(result.remaining,2);assert.equal(f.posts.length,2);assert.match(result.message,/broker reject/);
});
test("ambiguous submission retains the same command and never retries automatically", async () => {
  const f=fixture(),plan=captureCloseAllPlan(f.state);
  const result=await runCloseAll(plan,20,{...f.options,request:async p=>{if(p){await f.request(p);throw Error("network lost");}return f.request();}});
  assert.equal(f.posts.length,1);assert.equal(result.pendingCommand.id,f.posts[0].id);assert.equal(result.closed,0);
});
test("does not mistake a success receipt for a confirmed full close", async () => {
  const f=fixture(),plan=captureCloseAllPlan(f.state);let clock=0;
  const result=await runCloseAll(plan,20,{...f.options,timeoutMs:100,now:()=>clock,wait:async()=>{clock+=100;},request:async p=>{
    if(p)return f.request(p);if(f.posts.length){f.state.commands[0].status="succeeded";f.state.unresolved=0;}return structuredClone(f.state);
  }});
  assert.equal(f.posts.length,1);assert.equal(result.closed,0);assert.equal(result.outcome,"stopped");assert.match(result.message,/持仓|回报/);
});
test("pause or stopping later orders prevents continuing after the current receipt", async () => {
  for(const pause of [true,false]){
    const f=fixture(),plan=captureCloseAllPlan(f.state);let stop=false;
    const result=await runCloseAll(plan,20,{...f.options,shouldStop:()=>stop,onProgress:p=>{if(p.closed===1){if(pause)f.state.enabled=false;else stop=true;}}});
    assert.equal(result.closed,1);assert.equal(f.posts.length,1);assert.equal(result.remaining,2);assert.equal(result.outcome,"stopped");
  }
});
test("changing account, terminal or real permission midway never closes a later order", async () => {
  for (const mutate of [s=>s.accountKey="other",s=>s.snapshot.sessionId="other",s=>{s.snapshot.account.allowReal=false;}]) {
    const f=fixture();f.state.snapshot.account.mode="real";f.state.snapshot.account.allowReal=true;
    const plan=captureCloseAllPlan(f.state);
    const result=await runCloseAll(plan,20,{...f.options,onProgress:p=>{if(p.closed===1)mutate(f.state);}});
    assert.equal(result.closed,1);assert.equal(result.outcome,"stopped");assert.equal(f.posts.length,1);
  }
});
test("a definite rejection clears the unsent command and invalid slippage sends nothing", async () => {
  const f=fixture(),plan=captureCloseAllPlan(f.state);
  const result=await runCloseAll(plan,20,{...f.options,isDefiniteRejection:e=>e.definite===true,request:async p=>{if(p)throw Object.assign(Error("rejected"),{definite:true});return f.request();}});
  assert.equal(result.pendingCommand,undefined);assert.equal(f.posts.length,0);
  const invalid=await runCloseAll(plan,1.5,f.options);assert.equal(invalid.outcome,"stopped");assert.equal(f.posts.length,0);
});
test("skips externally closed positions and excludes newly appearing positions", async () => {
  const f=fixture(),plan=captureCloseAllPlan(f.state);let changed=false;
  const result=await runCloseAll(plan,20,{...f.options,onProgress:p=>{if(p.closed===1&&!changed){changed=true;f.state.snapshot.orders=f.state.snapshot.orders.filter(o=>o.ticket!==3);f.state.snapshot.orders.push(position(5));f.state.snapshot.orderCount=f.state.snapshot.orders.length;}}});
  assert.deepEqual(f.posts.map(p=>p.ticket),[1,2]);assert.equal(result.absent,1);assert.equal(result.closed,2);assert.equal(result.currentPositions,1);
});
test("aborted navigation and truncated snapshots stop before further commands", async () => {
  const f=fixture(),plan=captureCloseAllPlan(f.state);const controller=new AbortController();
  const result=await runCloseAll(plan,20,{...f.options,signal:controller.signal,onProgress:p=>{if(p.closed===1)controller.abort();}});
  assert.equal(f.posts.length,1);assert.equal(result.remaining,2);
  const g=fixture(),other=captureCloseAllPlan(g.state);
  const truncated=await runCloseAll(other,20,{...g.options,onProgress:p=>{if(p.closed===1)g.state.snapshot.orderCount=1000;}});
  assert.equal(g.posts.length,1);assert.equal(truncated.outcome,"stopped");
});
test("integrates with the real bridge queue and terminal receipt contract", async t => {
  const root=await mkdtemp(path.join(tmpdir(),"mt4-close-all-"));t.after(()=>rm(root,{recursive:true,force:true}));
  let time=Date.now();const bridge=await new Mt4Bridge({root,now:()=>time}).init();const pairing=await bridge.ui({action:"pair"});
  const q={symbol:"XAUUSD",digits:2,point:.01,bid:4000,ask:4000.1,quoteTime:Math.floor(time/1000),minLot:.01,maxLot:100,lotStep:.01,contractSize:100,tickValue:1,tickSize:.01,stopLevel:0,freezeLevel:0,tradeAllowed:true};
  const data={protocolVersion:1,sessionId:"test",capturedAt:Math.floor(time/1000),account:{login:"123",server:"demo",mode:"demo",currency:"USD",balance:1000,equity:1000,margin:20,freeMargin:980,profit:0,connected:true,tradeAllowed:true,allowReal:false},symbols:[q,{...q,symbol:"EURUSD"}],orders:[{...position(101),magic:0},{...position(102,"EURUSD"),magic:777},{...position(103),type:2}],history:[],receipts:[],chart:{symbol:"XAUUSD",timeframe:5,bars:[]}};
  const heartbeat=()=>bridge.terminal(pairing.token,{...data,capturedAt:Math.floor(time/1000)});
  await heartbeat();await bridge.ui({action:"enable",accountKey:bridge.status().accountKey,confirmation:"123"});
  const plan=captureCloseAllPlan(bridge.status()),posted=[];
  const result=await runCloseAll(plan,20,{now:()=>time,wait:async ms=>{time+=ms;},request:async payload=>{
    if(payload){posted.push(payload.command);return bridge.ui(payload);}
    if(bridge.status().commands.some(c=>c.status==="queued")){
      const wire=(await heartbeat()).wire.split("|");assert.equal(wire[6],"close");const ticket=Number(wire[15]);
      data.orders=data.orders.filter(o=>o.ticket!==ticket);data.receipts=[{id:wire[0],status:"succeeded",ticket,error:""}];await heartbeat();
    }
    return bridge.status();
  }});
  assert.equal(result.outcome,"complete");assert.equal(result.closed,2);assert.deepEqual(posted.map(c=>c.ticket),[101,102]);
  assert.deepEqual(bridge.status().snapshot.orders.map(o=>o.ticket),[103]);assert.equal(bridge.status().unresolved,0);
});
