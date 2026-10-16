import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Mt4Bridge } from "../local-data/mt4-bridge.mjs";
import { handleMt4Request, startMt4TerminalServer } from "../local-data/mt4-http.mjs";
import { readFileSync } from "node:fs";
import ts from "typescript";

async function serverFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "kline-mt4-http-"));
  const bridge = await new Mt4Bridge({ root }).init();
  const server = http.createServer(async (request, response) => {
    if (!await handleMt4Request(bridge, request, response)) { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  return { bridge, origin: `http://127.0.0.1:${server.address().port}`, headers: { "x-kline-mt4-session": bridge.uiSession } };
}
test("local service isolates MT4 from browser origins and invalid hosts", async t => {
  const { origin, headers: authorized } = await serverFixture(t);
  assert.equal((await fetch(`${origin}/mt4/status`, { headers: authorized })).status, 200);
  for (const headers of [{ origin: "https://evil.test" }, { "sec-fetch-site": "cross-site" }, { host: "evil.test" }]) {
    const status = await new Promise((resolve, reject) => {
      const request = http.get(`${origin}/mt4/status`, { headers: { ...authorized, ...headers } }, response => { response.resume(); resolve(response.statusCode); });
      request.on("error", reject);
    });
    assert.equal(status, 403, JSON.stringify(headers));
  }
  assert.equal((await fetch(`${origin}/mt4/status`, { method: "OPTIONS", headers: authorized })).status, 404);
  assert.equal((await fetch(`${origin}/mt4/status`)).status, 401);
  assert.equal((await fetch(`${origin}/mt4/browser-session`, { headers: { origin: "https://evil.test" } })).status, 403);
  const session = await fetch(`${origin}/mt4/browser-session`, { headers: { origin: "http://127.0.0.1:3101" } });
  assert.equal(session.headers.get("access-control-allow-origin"), "http://127.0.0.1:3101");
  assert.deepEqual(await session.json(), { token: authorized["x-kline-mt4-session"] });
});
test("first-use config uses standard HTTP for MT4 and keeps real trading off", async t => {
  const { origin, headers } = await serverFixture(t);
  assert.equal((await fetch(`${origin}/mt4/config`, { headers })).status, 409);
  const pair = await (await fetch(`${origin}/mt4/ui`, { headers, method: "POST", body: JSON.stringify({ action: "pair" }) })).json();
  assert.equal(pair.token.length, 48);
  const config = await (await fetch(`${origin}/mt4/config`, { headers })).text();
  assert.match(config, /^InpBridgeUrl=http:\/\/127\.0\.0\.1\/mt4\/terminal\r\n/);
  assert.match(config, /InpAllowReal=false/);
  const status = await (await fetch(`${origin}/mt4/status`, { headers })).json();
  assert.equal(status.token, undefined);
  assert.equal((await fetch(`${origin}/mt4/terminal`, { method: "POST", body: "{}" })).status, 401);
});
test("terminal receiver shares the bridge and exposes only the terminal endpoint", async t => {
  const { bridge, headers } = await serverFixture(t);
  const receiver = await startMt4TerminalServer(bridge, { port: 0 });
  t.after(() => new Promise(resolve => receiver.close(resolve)));
  const origin = `http://127.0.0.1:${receiver.address().port}`;
  assert.equal((await fetch(`${origin}/mt4/status`, { headers })).status, 404);
  assert.equal((await fetch(`${origin}/mt4/browser-session`, { headers: { origin: "http://127.0.0.1:3101" } })).status, 404);
  assert.equal((await fetch(`${origin}/mt4/terminal`, { method: "POST", body: "{}" })).status, 401);
  assert.equal((await fetch(`${origin}/mt4/terminal`, { method: "GET" })).status, 404);
  assert.equal(bridge.transportError, "");
  const pair = await bridge.ui({ action: "pair" });
  const now = Math.floor(Date.now() / 1000);
  const snapshot = { commandPollVersion: 1, protocolVersion: 1, sessionId: "receiver-test", capturedAt: now,
    account: { login: "12345", server: "Test-Demo", mode: "demo", currency: "USD", balance: 1000, equity: 1000,
      margin: 0, freeMargin: 1000, profit: 0, connected: true, tradeAllowed: true, allowReal: false },
    symbols: [{ symbol: "EURUSD", digits: 5, point: 0.00001, bid: 1.1, ask: 1.1002, quoteTime: now,
      minLot: 0.01, maxLot: 100, lotStep: 0.01, contractSize: 100000, tickValue: 1, tickSize: 0.00001, stopLevel: 0, freezeLevel: 0, tradeAllowed: true }],
    orders: [], history: [], chart: { symbol: "EURUSD", timeframe: 5, bars: [] }, receipts: [] };
  const connected = await fetch(`${origin}/mt4/terminal`, { method: "POST", headers: { authorization: `Bearer ${pair.token}`, "content-type": "application/json" }, body: JSON.stringify(snapshot) });
  assert.equal(connected.status, 200);
  assert.equal((await connected.json()).wire, "");
  const fast = await fetch(origin+"/mt4/execution", {method:"POST",headers:{authorization:"Bearer "+pair.token,"content-type":"application/json"},body:JSON.stringify(snapshot)});
  assert.equal(fast.status,200);assert.equal((await fast.json()).fastPollMs,200);
  assert.equal((await fetch(origin+"/mt4/execution", {method:"POST",body:"{}"})).status,401);
  assert.equal((await fetch(origin+"/mt4/execution", {method:"POST",headers:{origin:"https://evil.test",authorization:"Bearer "+pair.token},body:JSON.stringify(snapshot)})).status,403);
  assert.equal(bridge.status().connection, "connected");
  assert.equal(bridge.status().enabled, false);
});
test("occupied terminal port produces a recoverable connection error", async t => {
  const { bridge } = await serverFixture(t);
  const occupied = http.createServer();
  await new Promise(resolve => occupied.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  await assert.rejects(() => startMt4TerminalServer(bridge, { port: occupied.address().port }), /EADDRINUSE/);
  assert.match(bridge.status().transportError, /占用/);
});
const routeSource = ts.transpileModule(readFileSync(new URL("../app/api/mt4/route.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function routeFixture() {
  const calls = []; const route = {};
  new Function("require", "exports", routeSource)(() => ({ fetchLocalData: async (path, init) => {
    calls.push({ path, init });
    return path === "/mt4/config" ? new Response("InpAllowReal=false") : Response.json({ protocolVersion: 1, token: "secret", paired: true });
  } }), route);
  return { route, calls };
}
test("Web gateway rejects cross-origin and remote requests before proxying", async () => {
  const { route, calls } = routeFixture();
  for (const request of [new Request("http://example.test/api/mt4"), new Request("http://localhost:3101/api/mt4", { headers: { origin: "https://evil.test" } }),
    new Request("http://localhost:3101/api/mt4", { headers: { "sec-fetch-site": "cross-site" } }), new Request("http://localhost:3101/api/mt4", { method: "POST", body: '{"action":"pause"}' })]) {
    assert.equal((await (request.method === "POST" ? route.POST(request) : route.GET(request))).status, 403);
  }
  assert.equal(calls.length, 0);
});
test("Web gateway removes pairing token and downloads config without caching", async () => {
  const { route, calls } = routeFixture();
  const headers = { origin: "http://localhost:3101", "content-type": "application/json", "x-kline-mt4-session": "a".repeat(48) };
  const result = await route.POST(new Request("http://localhost:3101/api/mt4", { method: "POST", headers, body: '{"action":"pair"}' }));
  assert.equal(result.status, 200); assert.equal((await result.json()).token, undefined);
  const config = await route.GET(new Request("http://localhost:3101/api/mt4?action=config", { headers }));
  assert.match(config.headers.get("content-disposition"), /KLineTradeBridge.set/);
  assert.equal(config.headers.get("cache-control"), "no-store"); assert.equal(await config.text(), "InpAllowReal=false");
  assert.deepEqual(calls.map(c => c.path), ["/mt4/ui", "/mt4/config"]);
});
test("Web gateway validates operation and body before forwarding", async () => {
  const { route, calls } = routeFixture();
  for (const body of ["null", "[1]", "not-json", '{"action":"terminal"}', "a".repeat(16385)]) {
    const result = await route.POST(new Request("http://127.0.0.1:3101/api/mt4", { method: "POST", headers: { "x-kline-mt4": "1" }, body }));
    assert.ok([400, 413].includes(result.status));
  }
  assert.equal(calls.length, 0);
});
test("Web requests without the local browser session cannot read or mutate MT4", async () => {
  const { route, calls } = routeFixture();
  assert.equal((await route.GET(new Request("http://127.0.0.1:3101/api/mt4"))).status, 401);
  assert.equal((await route.POST(new Request("http://127.0.0.1:3101/api/mt4", { method: "POST", headers: { "x-kline-mt4": "1" }, body: '{"action":"pause"}' }))).status, 401);
  assert.equal(calls.length, 0);
});
