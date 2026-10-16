import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../app/features/mt4/mt4Gateway.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(fetcher) { const gateway = {}; new Function("exports", "fetch", source)(gateway, fetcher); return gateway; }
test("gateway obtains a loopback session, uses it on commands and renews after restart", async () => {
  const calls = []; let invalid = false;
  const gateway = fixture(async (url, init) => {
    calls.push({ url, init });
    if (url === "/api/mt4?action=connection") return Response.json({ origin: "http://127.0.0.1:3100" });
    if (url.endsWith("/mt4/browser-session")) return Response.json({ token: "a".repeat(48) });
    return invalid ? Response.json({ error: "会话失效" }, { status: 401 }) : Response.json({ protocolVersion: 1 });
  });
  await gateway.requestMt4(); await gateway.requestMt4({ action: "pause" });
  assert.equal(calls.filter(c => c.url.endsWith("/mt4/browser-session")).length, 1);
  assert.equal(calls.at(-1).init.headers["x-kline-mt4-session"], "a".repeat(48));
  assert.equal(calls.at(-1).init.body, '{"action":"pause"}');
  invalid = true; await assert.rejects(() => gateway.requestMt4(), /会话失效/);
  invalid = false; await gateway.requestMt4();
  assert.equal(calls.filter(c => c.url.endsWith("/mt4/browser-session")).length, 2);
});
test("gateway never requests a non-loopback connection and marks setup failure as definite", async () => {
  const calls = [];
  const gateway = fixture(async url => { calls.push(url); return Response.json({ origin: "https://evil.test" }); });
  await assert.rejects(() => gateway.requestMt4({ action: "command" }), e => e.definite === true && /本机/.test(e.message));
  assert.deepEqual(calls, ["/api/mt4?action=connection"]);
});
test("a failed submission without HTTP response remains uncertain", async () => {
  const gateway = fixture(async url => {
    if (url === "/api/mt4?action=connection") return Response.json({ origin: "http://127.0.0.1:3100" });
    if (url.endsWith("/mt4/browser-session")) return Response.json({ token: "a".repeat(48) });
    throw new TypeError("network interrupted");
  });
  await assert.rejects(() => gateway.requestMt4({ action: "command" }), e => e.definite !== true);
});

test("lost command response retries the exact same body once",async()=>{
 const bodies=[];const gateway=fixture(async(url,init)=>{
  if(url==="/api/mt4?action=connection")return Response.json({origin:"http://127.0.0.1:3100"});
  if(url.endsWith("/mt4/browser-session"))return Response.json({token:"a".repeat(48)});
  bodies.push(init.body);if(bodies.length===1)throw Error("lost reply");return Response.json({protocolVersion:1});
 });await gateway.requestMt4({action:"command",command:{id:"same-id"}});assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);
});
test("command renews an expired browser session once using the original command",async()=>{
 let sessions=0;const bodies=[];const gateway=fixture(async(url,init)=>{
  if(url==="/api/mt4?action=connection")return Response.json({origin:"http://127.0.0.1:3100"});
  if(url.endsWith("/mt4/browser-session")){sessions++;return Response.json({token:String(sessions).repeat(48)});}
  bodies.push(init.body);return sessions===1?Response.json({error:"expired"},{status:401}):Response.json({protocolVersion:1});
 });await gateway.requestMt4({action:"command",command:{id:"same-id"}});assert.equal(sessions,2);assert.deepEqual(bodies,[bodies[0],bodies[0]]);
});
test("aborting a background read cannot cancel a shared trade session bootstrap",async()=>{
 const controller=new AbortController();let release;const ready=new Promise(r=>{release=r});let bootstrapSignal;
 const gateway=fixture(async(url,init)=>{
  if(url==="/api/mt4?action=connection"){bootstrapSignal=init.signal;await ready;return Response.json({origin:"http://127.0.0.1:3100"});}
  if(url.endsWith("/mt4/browser-session"))return Response.json({token:"a".repeat(48)});
  return Response.json({protocolVersion:1});
 });const read=gateway.requestMt4(undefined,controller.signal);const trade=gateway.requestMt4({action:"command",command:{id:"same-id"}});controller.abort();release();await assert.rejects(()=>read);await trade;assert.equal(bootstrapSignal.aborted,false);
});

test("a rejection after a lost reply cannot falsely clear the original ambiguous submission",async()=>{
 let tries=0;const gateway=fixture(async url=>{
  if(url==="/api/mt4?action=connection")return Response.json({origin:"http://127.0.0.1:3100"});
  if(url.endsWith("/mt4/browser-session"))return Response.json({token:"a".repeat(48)});
  if(++tries===1)throw Error("reply lost after acceptance");return Response.json({error:"session changed"},{status:401});
 });await assert.rejects(()=>gateway.requestMt4({action:"command",command:{id:"same-id"}}),e=>e.definite===false);assert.equal(tries,2);
});
