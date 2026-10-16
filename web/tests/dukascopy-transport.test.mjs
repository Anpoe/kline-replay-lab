import assert from "node:assert/strict";
import test from "node:test";
import { createDukascopyFetcher } from "../app/lib/fx/dukascopyTransport.ts";

test("官方请求直接断线时仍使用免费连接，取消和其他域名保留原错误", async () => {
  let calls = 0;
  const failure = new TypeError("Network connection lost.");
  const fetcher = createDukascopyFetcher({
    fetchImpl: async () => { throw failure; },
    localFetchImpl: async () => { calls += 1; return Response.json({ status: 200, body: '{"code":"EUR/USD"}' }); },
  });
  assert.equal((await fetcher("https://jetta.dukascopy.com/v1/instruments/EUR-USD")).status, 200);
  await assert.rejects(fetcher("https://example.com/v1/instruments/EUR-USD"), (error) => error === failure);
  assert.equal(calls, 1);
  const controller = new AbortController();
  const cancelled = createDukascopyFetcher({ fetchImpl: async () => { controller.abort(); throw failure; }, localFetchImpl: async () => { throw new Error("不应调用"); } });
  await assert.rejects(cancelled("https://jetta.dukascopy.com/v1/instruments/EUR-USD", { signal: controller.signal }), { name: "AbortError" });
});

test("正常响应和限流保留普通请求，不启动浏览器连接", async () => {
  for (const status of [200, 404, 429]) {
    const fetcher = createDukascopyFetcher({
      fetchImpl: async () => new Response("{}", { status }),
      localFetchImpl: async () => { throw new Error("不应调用"); },
    });
    assert.equal((await fetcher("https://jetta.dukascopy.com/v1/instruments/EUR-USD")).status, status);
  }
});

test("访问验证触发本机免费连接并恢复相同的 JSON 响应", async () => {
  const calls = [];
  const fetcher = createDukascopyFetcher({
    fetchImpl: async () => new Response(null, { status: 202, headers: { "x-amzn-waf-action": "challenge" } }),
    localFetchImpl: async (url, init) => {
      calls.push({ url, method: init.method, body: JSON.parse(init.body) });
      return Response.json({ status: 200, headers: { "content-type": "application/json" }, body: '{"code":"EUR/USD"}' });
    },
  });
  assert.deepEqual(await (await fetcher("https://jetta.dukascopy.com/v1/instruments/EUR-USD")).json(), { code: "EUR/USD" });
  assert.deepEqual(calls, [{ url: "http://127.0.0.1:3100/dukascopy/json", method: "POST", body: { path: "/v1/instruments/EUR-USD" } }]);
});

test("免费连接保留浏览器上游限流，服务未更新时明确提示重启", async () => {
  const fetchImpl = async () => new Response(null, { status: 202 });
  const throttled = createDukascopyFetcher({ fetchImpl, localFetchImpl: async () => Response.json({ status: 429, headers: { "retry-after": "60" }, body: '{"error":"限流"}' }) });
  const response = await throttled("https://jetta.dukascopy.com/v1/instruments/EUR-USD");
  assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60");
  const unavailable = createDukascopyFetcher({ fetchImpl, localFetchImpl: async () => new Response("{}", { status: 404 }) });
  assert.match((await (await unavailable("https://jetta.dukascopy.com/v1/instruments/EUR-USD")).json()).error, /重启服务/);
});

test("不会把其他域名、自定义路径或取消的请求交给本机连接", async () => {
  let calls = 0;
  const fetcher = createDukascopyFetcher({ fetchImpl: async () => new Response(null, { status: 202 }), localFetchImpl: async () => { calls += 1; throw new Error("不应调用"); } });
  await fetcher("https://example.com/v1/instruments/EUR-USD");
  await fetcher("https://jetta.dukascopy.com/private");
  await assert.rejects(fetcher("https://jetta.dukascopy.com/v1/instruments/EUR-USD", { signal: AbortSignal.abort() }), { name: "AbortError" });
  assert.equal(calls, 0);
});
