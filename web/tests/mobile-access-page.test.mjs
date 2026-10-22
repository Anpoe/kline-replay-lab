import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { mobileConnectPage } from "../server/mobile-connect-page.mjs";

function page(initialHash = "") {
  const elements = new Map();
  const events = new Map();
  const storage = new Map();
  const location = { hash: initialHash, pathname: "/mobile-connect" };
  const node = (id) => {
    if (!elements.has(id)) elements.set(id, { hidden: ["pair", "waiting", "error", "retry", "enter"].includes(id), value: "我的手机", textContent: "", addEventListener(name, fn) { this[name] = fn; } });
    return elements.get(id);
  };
  const context = {
    document: { getElementById: node }, location, URLSearchParams, AbortSignal,
    history: { replaceState: () => { location.hash = ""; } },
    sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    addEventListener: (name, fn) => events.set(name, fn),
    fetch: async () => ({ ok: true, json: async () => ({ enabled: true, authorized: false }) }),
    setTimeout: () => 1, clearTimeout: () => {},
  };
  const source = mobileConnectPage("test", ":root{}").match(/<script[^>]*>([\s\S]*)<\/script>/)[1];
  vm.runInNewContext(source, context);
  return { node, events, location };
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
