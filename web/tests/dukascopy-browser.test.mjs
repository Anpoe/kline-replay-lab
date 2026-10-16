import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { createDukascopyBrowserConnection, dukascopyRequestUrl, handleDukascopyBrowserRequest } from "../local-data/dukascopy-browser.mjs";

test("免费连接只允许官方生产服务的品种和完整日 M1 路径", () => {
  assert.equal(dukascopyRequestUrl("/v1/instruments/EUR-USD"), "https://jetta.dukascopy.com/v1/instruments/EUR-USD");
  assert.match(dukascopyRequestUrl("/v1/candles/minute/XAU-USD/BID/2026/10/14"), /XAU-USD/);
  assert.match(dukascopyRequestUrl("/v1/candles/minute/XAU-USD/BID/1999/10/14"), /1999/);
  for (const path of ["https://example.com/", "//127.0.0.1/", "/v1/../admin", "/v1/instruments/%2E%2E%2Fprivate", "/v1/instruments/EUR-USD?redirect=1", "/v1/candles/minute/EUR-USD/BID/2026/2/30"]) {
    assert.throws(() => dukascopyRequestUrl(path), /行情请求/);
  }
});

test("本机连接拒绝网页跨站访问和任意地址，受限请求可以保留上游响应", async (t) => {
  let launched = 0;
  const connection = createDukascopyBrowserConnection({ launch: async () => {
    launched += 1;
    return { request: async () => ({ status: 200, headers: {}, body: '{"code":"EUR/USD"}' }), close: async () => {} };
  } });
  const server = http.createServer(async (request, response) => {
    if (!await handleDukascopyBrowserRequest(connection, request, response)) { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await connection.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const endpoint = `http://127.0.0.1:${server.address().port}/dukascopy/json`;
  const post = (body, extra = {}) => fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(body) });
  assert.equal((await post({ path: "/v1/instruments/EUR-USD" }, { origin: "https://example.com" })).status, 403);
  assert.equal((await post({ path: "https://example.com" })).status, 400);
  assert.equal((await fetch(endpoint)).status, 405);
  assert.equal(launched, 0);
  const result = await (await post({ path: "/v1/instruments/EUR-USD" })).json();
  assert.equal(result.status, 200); assert.equal(JSON.parse(result.body).code, "EUR/USD");
});

test("并发请求复用隔离连接、串行访问并保留上游状态和原始 JSON", async () => {
  let launches = 0, active = 0, maximum = 0, closed = 0;
  const connection = createDukascopyBrowserConnection({
    launch: async () => {
      launches += 1;
      return {
        async request(url) {
          active += 1; maximum = Math.max(maximum, active);
          await new Promise(setImmediate);
          active -= 1;
          return { status: url.includes("XAU") ? 429 : 200, headers: { "retry-after": "60" }, body: '{"code":"EUR/USD"}' };
        },
        async close() { closed += 1; },
      };
    },
  });
  const results = await Promise.all([connection.request("/v1/instruments/EUR-USD"), connection.request("/v1/instruments/XAU-USD")]);
  assert.equal(launches, 1); assert.equal(maximum, 1);
  assert.equal(results[0].body, '{"code":"EUR/USD"}');
  assert.equal(results[1].status, 429); assert.equal(results[1].headers["retry-after"], "60");
  await connection.close(); assert.equal(closed, 1);
});

test("连接失效后关闭本次会话，下次请求可以重新准备", async () => {
  let launches = 0, closed = 0;
  const connection = createDukascopyBrowserConnection({ launch: async () => {
    const first = ++launches === 1;
    return { request: async () => { if (first) throw new Error("连接中断"); return { status: 200, body: "{}", headers: {} }; }, close: async () => { closed += 1; } };
  } });
  await assert.rejects(connection.request("/v1/instruments/EUR-USD"), /连接中断/);
  assert.equal(closed, 1);
  assert.equal((await connection.request("/v1/instruments/EUR-USD")).status, 200);
  await connection.close(); assert.equal(launches, 2); assert.equal(closed, 2);
});

test("已取消请求不会启动浏览器，关闭后不再接受请求", async () => {
  let launches = 0;
  const connection = createDukascopyBrowserConnection({ launch: async () => { launches += 1; throw new Error("不应启动"); } });
  await assert.rejects(connection.request("/v1/instruments/EUR-USD", { signal: AbortSignal.abort() }), { name: "AbortError" });
  assert.equal(launches, 0);
  await connection.close();
  await assert.rejects(connection.request("/v1/instruments/EUR-USD"), /已关闭/);
});

test("闲置连接会退出，后续更新按需重新准备", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let launches = 0, closed = 0;
  const connection = createDukascopyBrowserConnection({ idleMs: 100, launch: async () => {
    launches += 1;
    return { request: async () => ({ status: 200, headers: {}, body: "{}" }), close: async () => { closed += 1; } };
  } });
  await connection.request("/v1/instruments/EUR-USD");
  t.mock.timers.tick(100); await new Promise(setImmediate);
  assert.equal(closed, 1);
  await connection.request("/v1/instruments/EUR-USD");
  assert.equal(launches, 2); await connection.close();
});

test("准备连接时收到关闭动作，准备完成后释放会话并取消读取", async () => {
  let ready, started, reads = 0, closes = 0;
  const starting = new Promise(resolve => { started = resolve; });
  const connection = createDukascopyBrowserConnection({ launch: async () => {
    started(); await new Promise(resolve => { ready = resolve; });
    return { request: async () => { reads += 1; }, close: async () => { closes += 1; } };
  } });
  const rejected = assert.rejects(connection.request("/v1/instruments/EUR-USD"), /已关闭/);
  await starting;
  const closing = connection.close(); ready();
  await Promise.all([rejected, closing]);
  assert.equal(reads, 0); assert.equal(closes, 1);
});

test("缺少浏览器时保留可执行的恢复提示", async (t) => {
  const connection = createDukascopyBrowserConnection({ launch: async () => {
    const error = new Error("免费行情连接需要 Microsoft Edge，请安装后重试"); error.status = 412; throw error;
  } });
  const server = http.createServer(async (request, response) => { await handleDukascopyBrowserRequest(connection, request, response); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await connection.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/dukascopy/json`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "/v1/instruments/EUR-USD" }) });
  assert.equal(response.status, 412); assert.match((await response.json()).error, /Microsoft Edge.*安装后重试/);
});
