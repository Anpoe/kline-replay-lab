import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { mobileConnectPage } from "../server/mobile-connect-page.mjs";

function page(initialHash = "", { authorized = false, canRequestPairing = false, reply } = {}) {
  const elements = new Map();
  const events = new Map();
  const storage = new Map();
  const location = { hash: initialHash, pathname: "/mobile-connect", replace(url) { this.replaced = url; } };
  const calls = [];
  const node = (id) => {
    if (!elements.has(id)) elements.set(id, { hidden: ["pair", "waiting", "error", "retry", "enter"].includes(id), value: "我的手机", textContent: "", addEventListener(name, fn) { this[name] = fn; } });
    return elements.get(id);
  };
  const context = {
    document: { getElementById: node }, location, URLSearchParams, AbortSignal,
    history: { replaceState: () => { location.hash = ""; } },
    sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    addEventListener: (name, fn) => events.set(name, fn),
    fetch: async (url, options) => { calls.push({ url, body: options.body ? JSON.parse(options.body) : undefined }); return reply?.(url, options) ?? { ok: true, json: async () => ({ enabled: true, authorized, canRequestPairing }) }; },
    setTimeout: () => 1, clearTimeout: () => {},
  };
  const source = mobileConnectPage("test", ":root{}").match(/<script[^>]*>([\s\S]*)<\/script>/)[1];
  vm.runInNewContext(source, context);
  return { node, events, location, calls };
}

const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

test("opening a new QR in an existing connection tab starts pairing and removes the secret fragment", async () => {
  const browser = page();
  await flush();
  assert.equal(browser.node("pair").hidden, true);
  browser.location.hash = "#code=new-scan";
  browser.events.get("hashchange")?.();
  await flush();
  assert.equal(browser.node("pair").hidden, false);
  assert.equal(browser.location.hash, "");
});

test("first navigation still consumes the QR fragment and displays the device form", async () => {
  const browser = page("#code=first-scan");
  await flush();
  assert.equal(browser.node("pair").hidden, false);
  assert.equal(browser.location.hash, "");
});

test("a direct domain offers a first connection without a QR while authorized visits enter automatically", async () => {
  const browser = page("", { canRequestPairing: true });
  await flush();
  assert.equal(browser.node("pair").hidden, false);
  await browser.node("pair").submit({ preventDefault() {} });
  const submitted = browser.calls.find(call => call.url.endsWith("/pair"));
  assert.equal(submitted.body.code, undefined);
  assert.equal(submitted.body.name, "我的手机");
  const returning = page("", { authorized: true, canRequestPairing: true });
  await flush();
  assert.equal(returning.location.replaced, "/");
});

test("an expired direct connection request offers a new request instead of a broken retry loop", async () => {
  const browser = page("", { reply: url => ({ ok: !url.endsWith("/claim"), status: url.endsWith("/claim") ? 410 : 200, json: async () => url.endsWith("/session") ? { enabled: true, authorized: false, canRequestPairing: true } : url.endsWith("/pair") ? { id: "request", secret: "secret", number: "123456" } : { error: "配对已结束，请重新扫码。" } }) });
  await flush();
  await browser.node("pair").submit({ preventDefault() {} });
  await flush();
  assert.equal(browser.node("waiting").hidden, true);
  assert.equal(browser.node("pair").hidden, false);
  assert.match(browser.node("error").textContent, /重新请求连接/);
});
