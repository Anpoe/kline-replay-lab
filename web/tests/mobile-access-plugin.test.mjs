import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mobileAccessPlugin } from "../server/mobile-access-plugin.mjs";
import { TailscaleAccess } from "../server/tailscale-access.mjs";

test("verified ingress crosses frozen Vite host checks without granting localhost administration", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kline-mobile-host-"));
  await mkdir(path.join(root, "app")); await writeFile(path.join(root, "app/globals.css"), ":root { --background: black; }");
  const stack = [];
  const frozenHosts = Object.freeze(["localhost", "127.0.0.1"]);
  const server = http.createServer((req, res) => {
    if (!frozenHosts.includes(req.headers.host.split(":")[0])) { res.writeHead(403); res.end("frozen host check"); return; }
    let index = 0;
    const next = () => stack[index++]?.(req, res, next);
    next();
  });
  server.on("upgrade", (req, socket) => {
    if (socket.destroyed) return;
    assert.ok(frozenHosts.includes(req.headers.host.split(":")[0]));
    assert.equal(req.url, "/socket");
    socket.end("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const originalInit = TailscaleAccess.prototype.init;
  const remote = await new TailscaleAccess({ stateFile: path.join(root, "remote.json"), findCli: async () => "fixture", run: async (_file, args) => ({ stdout: JSON.stringify(args[0] === "status" ? { BackendState: "Running", Self: { ID: "node", DNSName: "pc.example.ts.net.", Online: true } } : { TCP: { 443: { HTTPS: true } }, Web: { "pc.example.ts.net:443": { Handlers: { "/": { Proxy: remote.target() } } } } }) }) }).init();
  remote.data.enabled = true; remote.data.binding = { nodeId: "node", hostname: "pc.example.ts.net", httpsPort: 443, backendPort: port };
  TailscaleAccess.prototype.init = async () => remote;
  t.after(async () => {
    TailscaleAccess.prototype.init = originalInit;
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  await mobileAccessPlugin().configureServer({ httpServer: server, config: { root, server: { port, allowedHosts: [] } }, middlewares: { use: handler => stack.push(handler) } });
  TailscaleAccess.prototype.init = originalInit;
  const local = `http://127.0.0.1:${port}`;
  const origin = "https://pc.example.ts.net";
  const headers = { host: "pc.example.ts.net", origin, "x-forwarded-host": "pc.example.ts.net", "x-forwarded-proto": "https", "tailscale-user-login": "fixture@example.com" };
  const gateway = `/__kline-tailscale/${remote.data.gatewayToken}`;
  // Raw HTTP preserves Host for proxy simulation; fetch may rewrite it to its URL.
  const raw = (pathname, options = {}) => new Promise((resolve, reject) => {
    const request = http.request(local + pathname, options, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: response.statusCode, headers: new Headers(Object.entries(response.headers).flatMap(([key, value]) => Array.isArray(value) ? value.map(item => [key, item]) : [[key, value]])), text: async () => text, json: async () => JSON.parse(text) });
      });
    });
    request.on("error", reject); request.end(options.body);
  });
  const initial = await (await fetch(local + "/api/mobile-access")).json();
  const admin = async (action, extra = {}) => (await fetch(local + "/api/mobile-access", { method: "POST", headers: { origin: local, "content-type": "application/json", "x-kline-mobile-admin": initial.adminToken }, body: JSON.stringify({ action, ...extra }) })).json();
  const post = (pathname, body) => raw(gateway + pathname, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
  const denied = await raw(gateway + "/api/preferences", { headers }); assert.equal(denied.status, 401, await denied.text());
  assert.equal((await raw(gateway + "/api/mobile-access", { headers })).status, 403);
  assert.equal((await raw("/api/mobile-access", { headers: { ...headers, host: `localhost:${port}` } })).status, 403);
  assert.equal(await (await raw("/api/mobile-access", { headers: { host: "evil.example" } })).text(), "frozen host check");
  const enabled = await admin("enable");
  const pair = await (await post("/api/mobile-access/pair", { code: enabled.challenge.code, name: "远程手机" })).json();
  await admin("approve", { id: pair.id, number: pair.number });
  const claimed = await post("/api/mobile-access/claim", { id: pair.id, secret: pair.secret });
  const cookie = claimed.headers.get("set-cookie").split(";")[0];
  await new Promise((resolve, reject) => {
    const request = http.request(local + gateway + "/socket", { headers: { ...headers, cookie, connection: "Upgrade", upgrade: "websocket" } });
    request.on("upgrade", (response, socket) => { assert.equal(response.statusCode, 101); socket.destroy(); resolve(); });
    request.on("error", reject); request.end();
  });
});
