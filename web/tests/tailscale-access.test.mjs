import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TailscaleAccess } from "../server/tailscale-access.mjs";

async function fixture(t, changes = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "kline-tailscale-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const machine = { installed: true, status: { BackendState: "Running", Self: { ID: "node-1", DNSName: "my-pc.example.ts.net.", Online: true } }, config: {}, calls: [], failure: null, opened: 0, ...changes };
  let now = 1_800_000_000_000;
  const options = { stateFile: path.join(root, "tailscale-access.json"), now: () => now,
    findCli: async () => machine.installed ? "C:/Program Files/Tailscale/tailscale.exe" : null,
    openClient: async () => { machine.opened++; },
    run: async (_file, args) => {
      machine.calls.push(args);
      if (args[0] === "status") return { stdout: JSON.stringify(machine.status) };
      if (args.join(" ") === "serve status --json") return { stdout: JSON.stringify(machine.config) };
      if (machine.failure) throw machine.failure;
      assert.equal(args[0], "serve"); assert.ok(args.includes("--bg"));
      const port = Number(args.find(a => a.startsWith("--https=")).split("=")[1]);
      const key = `${machine.status.Self.DNSName.replace(/\.$/, "")}:${port}`;
      if (args.at(-1) === "off") { delete machine.config.TCP?.[port]; delete machine.config.Web?.[key]; }
      else {
        machine.config.TCP ??= {}; machine.config.Web ??= {};
        machine.config.TCP[port] = { HTTPS: true };
        machine.config.Web[key] = { Handlers: { "/": { Proxy: args.at(-1) } } };
      }
      return { stdout: "" };
    } };
  const controller = await new TailscaleAccess(options).init();
  return { controller, machine, options, advance: ms => { now += ms; } };
}

test("fresh install exposes installation, login, machine approval and offline recovery without configuring anything", async t => {
  const { controller, machine } = await fixture(t, { installed: false });
  assert.equal((await controller.inspect()).state, "not-installed");
  machine.installed = true; machine.status.BackendState = "NeedsLogin";
  assert.equal((await controller.inspect(true)).state, "needs-login");
  machine.status.BackendState = "NeedsMachineAuth";
  assert.equal((await controller.inspect(true)).state, "needs-approval");
  machine.status.BackendState = "Stopped";
  assert.equal((await controller.inspect(true)).state, "not-running");
  machine.status.BackendState = "Running"; machine.status.Self.Online = false;
  assert.equal((await controller.inspect(true)).state, "offline");
  assert.equal(machine.calls.some(args => args[0] === "serve" && args[1] !== "status"), false);
});

test("preparation creates a private HTTPS mapping and only exposes a public pairing origin", async t => {
  const { controller, machine, options } = await fixture(t);
  assert.equal((await controller.inspect()).state, "not-configured");
  const ready = await controller.prepare(3101);
  assert.equal(ready.state, "ready");
  assert.equal(ready.url, "https://my-pc.example.ts.net");
  const proxy = machine.config.Web["my-pc.example.ts.net:443"].Handlers["/"].Proxy;
  assert.match(proxy, /^http:\/\/127\.0\.0\.1:3101\/__kline-tailscale\/[A-Za-z0-9_-]{43}\/$/);
  assert.ok(!JSON.stringify(ready).includes(new URL(proxy).pathname));
  assert.ok(!machine.calls.some(args => args.includes("funnel") || args.includes("reset")));
  const persisted = JSON.parse(await readFile(options.stateFile, "utf8"));
  assert.equal(persisted.enabled, true);
  await controller.inspect(); await controller.inspect();
  assert.equal(machine.calls.filter(args => args[0] === "status").length, 3, "mutations recheck ownership, while subsequent status polling uses a cache");
});

test("existing Serve ports are preserved and a different free port is selected", async t => {
  const other = { TCP: { 443: { HTTPS: true } }, Web: { "my-pc.example.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8000" } } } } };
  const { controller, machine } = await fixture(t, { config: structuredClone(other) });
  const ready = await controller.prepare(3101);
  assert.equal(ready.url, "https://my-pc.example.ts.net:8443");
  assert.deepEqual(machine.config.Web["my-pc.example.ts.net:443"], other.Web["my-pc.example.ts.net:443"]);
  await controller.disable();
  assert.deepEqual(machine.config.Web["my-pc.example.ts.net:443"], other.Web["my-pc.example.ts.net:443"]);
  assert.equal(machine.config.Web["my-pc.example.ts.net:8443"], undefined);
});

test("restart verifies ownership, account changes, Funnel and changed routes fail closed", async t => {
  const { controller, machine, options } = await fixture(t);
  await controller.prepare(3101);
  const restarted = await new TailscaleAccess(options).init();
  assert.equal((await restarted.inspect(true)).state, "ready");
  machine.config.AllowFunnel = { "my-pc.example.ts.net:443": true };
  assert.equal((await restarted.inspect(true)).state, "configuration-changed");
  assert.equal(restarted.snapshot().url, null);
  delete machine.config.AllowFunnel;
  machine.config.Web["my-pc.example.ts.net:443"].Handlers["/"].Proxy = "http://127.0.0.1:9999";
  assert.equal((await restarted.inspect(true)).state, "configuration-changed");
  const mutations = machine.calls.length;
  await restarted.disable();
  assert.ok(machine.calls.slice(mutations).every(args => args[1] === "status" || args[0] === "status"), "changed user configuration must not be removed");
  machine.status.Self.ID = "different-account-node";
  assert.notEqual((await restarted.inspect(true)).state, "ready");
});

test("HTTPS consent URL is allowlisted and retry completes setup", async t => {
  const { controller, machine } = await fixture(t);
  machine.failure = Object.assign(new Error("failed"), { stderr: "Enable Serve at https://login.tailscale.com/f/serve?node=abc\n", code: 1 });
  const pending = await controller.prepare(3101);
  assert.equal(pending.state, "needs-consent");
  assert.equal(pending.consentUrl, "https://login.tailscale.com/f/serve?node=abc");
  assert.equal(pending.url, null);
  assert.equal((await controller.inspect(true)).consentUrl, pending.consentUrl, "background status checks retain the required consent action");
  machine.failure = null;
  assert.equal((await controller.prepare(3101)).state, "ready");
});

test("a changed app port fails closed and a failed status check cannot remove a stale route", async t => {
  const { controller, machine, options } = await fixture(t);
  await controller.prepare(3101);
  const moved = await new TailscaleAccess({ ...options, backendPort: () => 3102 }).init();
  assert.equal((await moved.inspect()).state, "configuration-changed");
  machine.status.BackendState = "Stopped";
  const before = machine.calls.length;
  assert.equal((await controller.disable()).state, "cleanup-needed");
  assert.ok(machine.calls.slice(before).every(args => args[0] === "status"));
  assert.ok(machine.config.Web["my-pc.example.ts.net:443"]);
  assert.equal(controller.snapshot().enabled, false);
});

test("login-required JSON from a nonzero CLI exit remains recoverable", async t => {
  const { options } = await fixture(t);
  const controller = await new TailscaleAccess({ ...options, run: async () => { throw Object.assign(new Error("logged out"), { stdout: JSON.stringify({ BackendState: "NeedsLogin" }) }); } }).init();
  assert.equal((await controller.inspect()).state, "needs-login");
});

test("remote ingress requires the private path, loopback socket, private identity and a fresh verified configuration", async t => {
  const { controller, machine, advance } = await fixture(t);
  await controller.prepare(3101);
  const proxy = machine.config.Web["my-pc.example.ts.net:443"].Handlers["/"].Proxy;
  const request = (extra = {}) => ({ url: new URL(proxy).pathname + "api/preferences?x=1", socket: { remoteAddress: "127.0.0.1" }, headers: { host: "my-pc.example.ts.net", "x-forwarded-host": "my-pc.example.ts.net", "x-forwarded-proto": "https", "tailscale-user-login": "user@example.com" }, ...extra });
  const req = request();
  assert.equal(controller.resolveRequest(req).origin, "https://my-pc.example.ts.net");
  assert.equal(req.url, "/api/preferences?x=1");
  assert.equal(controller.resolveRequest(request({ socket: { remoteAddress: "192.168.1.5" } })).kind, "denied");
  assert.equal(controller.resolveRequest(request({ headers: { host: "localhost:3101", "tailscale-funnel-request": "?1" } })).kind, "denied");
  assert.equal(controller.resolveRequest(request({ headers: { host: "localhost:3101" } })).kind, "denied");
  assert.equal(controller.resolveRequest(request({ url: "/__kline-tailscale/" + "坏".repeat(43) + "/api/preferences" })).kind, "denied", "malformed multibyte secrets must not crash the HTTP ingress");
  assert.equal(controller.resolveRequest({ ...request(), url: "/api/mobile-access" }), null);
  advance(31_000);
  assert.equal(controller.resolveRequest(request()).kind, "denied");
});

test("corrupt persistence and unsafe consent output do not open remote access or launch links", async t => {
  const { options, controller, machine } = await fixture(t);
  await writeFile(options.stateFile, "{broken");
  assert.equal((await new TailscaleAccess(options).init()).snapshot().enabled, false);
  machine.failure = Object.assign(new Error("secret diagnostic"), { stderr: "https://login.tailscale.com.evil.example/approve private-secret", code: 1 });
  const status = await controller.prepare(3101);
  assert.equal(status.state, "error");
  assert.equal(status.consentUrl, null);
  assert.ok(!JSON.stringify(status).includes("private-secret"));
  await controller.openClient();
  assert.equal(machine.opened, 1);
});
