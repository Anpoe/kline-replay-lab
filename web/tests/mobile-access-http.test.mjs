import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { MobileAccess } from "../server/mobile-access.mjs";
import { createMobileAccessHandler, canUpgrade } from "../server/mobile-access-http.mjs";
import { TailscaleAccess } from "../server/tailscale-access.mjs";

async function fixture(t, tailscale) {
  const root = await mkdtemp(path.join(os.tmpdir(), "kline-mobile-http-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = await new MobileAccess({ stateFile: path.join(root, "access.json") }).init();
  const handler = createMobileAccessHandler({ service, tailscale, interfaces: () => ({ WiFi: [{ address: "192.168.1.4", family: "IPv4", internal: false }] }), port: () => 3101, firewall: async () => {} });
  async function request(url, { local = false, body, cookie, origin, host, adminToken, method = body === undefined ? "GET" : "POST", headers = {} } = {}) {
    host ??= local ? "localhost:3101" : "192.168.1.4:3101";
    const req = Readable.from(body === undefined ? [] : [typeof body === "string" ? body : JSON.stringify(body)]);
    req.method = method; req.url = url;
    req.socket = { remoteAddress: local ? "127.0.0.1" : "192.168.1.5", localAddress: local ? "127.0.0.1" : "192.168.1.4" };
    req.headers = { host, ...(body === undefined ? {} : { "content-type": "application/json", origin: `http://${host}` }), ...(origin === undefined ? {} : { origin }), ...(cookie ? { cookie } : {}), ...(adminToken ? { "x-kline-mobile-admin": adminToken } : {}), ...headers };
    const response = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, end(data = "") { this.body = data; } };
    let passed = false;
    await handler(req, response, () => { passed = true; });
    return { ...response, passed, json: () => JSON.parse(response.body) };
  }
  return { service, request };
}

test("private HTTPS proxy pairs with Secure cookies and can never become a local administrator", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kline-tailscale-http-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tailscale = await new TailscaleAccess({ stateFile: path.join(root, "remote.json") }).init();
  tailscale.data.enabled = true;
  tailscale.data.binding = { nodeId: "node", hostname: "pc.example.ts.net", httpsPort: 443, backendPort: 3101 };
  tailscale.verified = Date.now();
  tailscale.show("ready", { url: "https://pc.example.ts.net" });
  const { service, request } = await fixture(t, tailscale);
  const gateway = `/__kline-tailscale/${tailscale.data.gatewayToken}`;
  const options = { local: true, host: "pc.example.ts.net", origin: "https://pc.example.ts.net", headers: { "x-forwarded-host": "pc.example.ts.net", "x-forwarded-proto": "https", "tailscale-user-login": "me@example.com" } };
  assert.equal((await request(`${gateway}/api/preferences`, options)).statusCode, 401);
  assert.equal((await request(`${gateway}/api/mobile-access`, options)).statusCode, 403);
  assert.equal((await request("/api/mobile-access", { local: true, headers: options.headers })).statusCode, 403, "misconfigured proxy must not inherit loopback admin");
  await service.setEnabled(true);
  const pair = (await request(`${gateway}/api/mobile-access/pair`, { ...options, body: { code: service.rotateChallenge().code, name: "远程手机" } })).json();
  service.approve(pair.id, pair.number);
  const claim = await request(`${gateway}/api/mobile-access/claim`, { ...options, body: { id: pair.id, secret: pair.secret } });
  assert.match(claim.headers["set-cookie"], /; Secure/);
  const cookie = claim.headers["set-cookie"].split(";")[0];
  assert.equal((await request(`${gateway}/api/preferences`, { ...options, cookie, body: {} })).passed, true);
  assert.equal((await request(`${gateway}/api/preferences`, { ...options, cookie, body: {}, origin: "http://pc.example.ts.net" })).statusCode, 403);
  assert.equal((await request(`${gateway}/api/mobile-access`, { ...options, cookie, body: { action: "disable" }, adminToken: service.adminToken })).statusCode, 403);
  assert.equal((await request(`${gateway}/api/preferences`, { ...options, cookie, headers: { ...options.headers, "tailscale-funnel-request": "?1" } })).statusCode, 403);
  const ws = () => ({ url: `${gateway}/socket`, socket: { remoteAddress: "127.0.0.1" }, headers: { ...options.headers, host: options.host, origin: options.origin, cookie } });
  assert.equal(canUpgrade(ws(), service, tailscale), true);
  await service.revoke(pair.id);
  assert.equal(canUpgrade(ws(), service, tailscale), false);
});

test("all business paths, static assets and upgrades require authorization, while loopback keeps working", async (t) => {
  const { service, request } = await fixture(t);
  for (const url of ["/api/preferences", "/api/mt4/command", "/@fs/private", "/app/components/TrainingWorkbench.tsx", "/?__rsc=1"]) {
    assert.equal((await request(url)).statusCode, 401, url);
    assert.equal((await request(url, { local: true })).passed, true, url);
  }
  const forged = await request("/api/mobile-access", { headers: { "x-forwarded-for": "127.0.0.1" } });
  assert.equal(forged.statusCode, 403);
  assert.equal((await request("/", { host: "localhost:3101" })).statusCode, 403);
  assert.equal(canUpgrade({ socket: { remoteAddress: "192.168.1.5", localAddress: "192.168.1.4" }, headers: { host: "192.168.1.4:3101", origin: "http://192.168.1.4:3101" } }, service), false);
});

test("management rejects missing nonce, cross-origin writes and mobile devices", async (t) => {
  const { service, request } = await fixture(t);
  const body = { action: "enable" };
  assert.equal((await request("/api/mobile-access", { local: true, body })).statusCode, 403);
  assert.equal((await request("/api/mobile-access", { local: true, body, adminToken: service.adminToken, origin: "http://evil.example" })).statusCode, 403);
  assert.equal((await request("/api/mobile-access", { body, adminToken: service.adminToken })).statusCode, 403);
  const enabled = await request("/api/mobile-access", { local: true, body, adminToken: service.adminToken });
  assert.equal(enabled.statusCode, 200);
  assert.equal(enabled.json().enabled, true);
});

test("HTTP pairing issues HttpOnly cookies only after approval and revocation blocks API and WebSocket", async (t) => {
  const { service, request } = await fixture(t);
  await service.setEnabled(true);
  const code = service.rotateChallenge().code;
  const pairing = (await request("/api/mobile-access/pair", { body: { code, name: "我的手机" } })).json();
  const claim = { id: pairing.id, secret: pairing.secret };
  assert.equal((await request("/api/mobile-access/claim", { body: claim })).json().status, "pending");
  service.approve(pairing.id, pairing.number);
  const approved = await request("/api/mobile-access/claim", { body: claim });
  assert.match(approved.headers["set-cookie"], /HttpOnly; SameSite=Strict/);
  assert.ok(!approved.body.includes(pairing.secret));
  const cookie = approved.headers["set-cookie"].split(";")[0];
  assert.equal((await request("/api/preferences", { cookie })).passed, true);
  assert.equal((await request("/api/preferences", { cookie, body: {}, origin: "http://evil.example" })).statusCode, 403);
  assert.equal((await request("/api/preferences", { cookie, body: {} })).passed, true);
  const ws = { socket: { remoteAddress: "192.168.1.5", localAddress: "192.168.1.4" }, headers: { cookie, host: "192.168.1.4:3101", origin: "http://192.168.1.4:3101" } };
  assert.equal(canUpgrade(ws, service), true);
  await service.revoke(pairing.id);
  assert.equal((await request("/api/preferences", { cookie })).statusCode, 401);
  assert.equal(canUpgrade(ws, service), false);
});

test("pairing page is self-contained, QR encodes a fragment, invalid and oversized JSON are recoverable", async (t) => {
  const { service, request } = await fixture(t);
  const page = await request("/mobile-connect");
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /设备名称/);
  assert.match(page.headers["content-security-policy"], /default-src 'none'/);
  assert.equal((await request("/api/mobile-access/pair", { body: "{" })).statusCode, 400);
  assert.equal((await request("/api/mobile-access/pair", { body: "x".repeat(5000) })).statusCode, 413);
  await service.setEnabled(true);
  const challenge = service.rotateChallenge();
  const status = (await request("/api/mobile-access", { local: true })).json();
  assert.ok(status.addresses[0].url.endsWith(`#code=${challenge.code}`));
  const qr = await request(`/api/mobile-access/qr?address=192.168.1.4&code=${challenge.code}`, { local: true });
  assert.match(qr.body, /<svg/);
  assert.equal((await request(`/api/mobile-access/qr?address=evil.example&code=${challenge.code}`, { local: true })).statusCode, 400);
});

test("pairing attempts are bounded without consuming a valid QR and denied requests never set cookies", async (t) => {
  const { service, request } = await fixture(t);
  await service.setEnabled(true);
  const code = service.rotateChallenge().code;
  for (let index = 0; index < 20; index++) {
    const denied = await request("/api/mobile-access/pair", { body: { code: "wrong", name: "Phone" } });
    assert.equal(denied.statusCode, 410);
    assert.equal(denied.headers["set-cookie"], undefined);
  }
  const limited = await request("/api/mobile-access/pair", { body: { code, name: "Phone" } });
  assert.equal(limited.statusCode, 429);
  assert.equal(service.status().challenge.code, code);
});
