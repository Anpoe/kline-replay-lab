import { execFile, spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const ingress = "/__kline-tailscale/";
const context = Symbol("kline-tailscale-context");
const loopback = address => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
const runCli = (file, args) => execute(file, args, { windowsHide: true, shell: false, timeout: 20_000, maxBuffer: 1024 * 1024 });
async function findCli() {
  const candidates = process.platform === "win32"
    ? [path.join(process.env.ProgramFiles ?? "C:/Program Files", "Tailscale/tailscale.exe"), ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map(dir => path.join(dir, "tailscale.exe"))]
    : (process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map(dir => path.join(dir, "tailscale"));
  for (const file of candidates) { try { await access(file); return file; } catch { /* next installed location */ } }
  return null;
}
async function openClient(file) {
  if (process.platform !== "win32") throw new Error("请从系统菜单打开 Tailscale 并连接后重新检查。");
  const gui = path.join(path.dirname(file), "tailscale-ipn.exe");
  await access(gui);
  await new Promise((resolve, reject) => {
    const child = spawn(gui, [], { windowsHide: true, detached: true, stdio: "ignore", shell: false });
    child.once("error", reject); child.once("spawn", () => { child.unref(); resolve(); });
  });
}
function consentFrom(error) {
  for (const raw of `${error.stdout ?? ""}\n${error.stderr ?? ""}`.match(/https:\/\/[^\s<>"']+/g) ?? []) {
    try { const url = new URL(raw); if (url.hostname === "login.tailscale.com" && !url.username && !url.password && !url.port) return url.href; } catch { /* untrusted diagnostics */ }
  }
  return null;
}
function configs(config) { return [config, ...Object.values(config.Foreground ?? {})]; }
function occupied(config, port) {
  return configs(config).some(item => item.TCP?.[port] || Object.keys(item.Web ?? {}).some(key => key.endsWith(`:${port}`)) || Object.entries(item.AllowFunnel ?? {}).some(([key, value]) => value && key.endsWith(`:${port}`)));
}

/** Owns one private Serve route; never changes global Tailscale preferences. */
export class TailscaleAccess {
  constructor({ stateFile, backendPort, now = Date.now, findCli: discover = findCli, run = runCli, openClient: open = openClient }) {
    Object.assign(this, { stateFile, backendPort, now, discover, run, open });
    this.data = { version: 1, enabled: false, gatewayToken: randomBytes(32).toString("base64url"), binding: null };
    this.view = { state: "not-configured", enabled: false, url: null, consentUrl: null };
    this.checked = 0; this.verified = 0; this.queue = Promise.resolve();
  }
  async init() {
    try {
      const value = JSON.parse(await readFile(this.stateFile, "utf8"));
      const binding = value.binding;
      if (value.version !== 1 || typeof value.enabled !== "boolean" || !/^[A-Za-z0-9_-]{43}$/.test(value.gatewayToken)
        || (binding && (!/^[a-z0-9.-]+\.ts\.net$/.test(binding.hostname) || typeof binding.nodeId !== "string" || ![443, 8443, 9443].includes(binding.httpsPort) || !Number.isInteger(binding.backendPort) || binding.backendPort < 1 || binding.backendPort > 65535))) throw new Error("invalid state");
      if (value.enabled && !binding) throw new Error("missing binding");
      this.data = { version: 1, enabled: value.enabled, gatewayToken: value.gatewayToken, binding: binding ?? null };
    } catch (error) {
      if (error.code !== "ENOENT") this.storageError = true;
    }
    return this;
  }
  snapshot() { return { ...this.view, enabled: this.data.enabled }; }
  show(state, extra = {}) {
    this.view = { state, url: null, consentUrl: null, ...extra };
    if (state !== "ready") this.verified = 0;
    return this.snapshot();
  }
  async persist() {
    await mkdir(path.dirname(this.stateFile), { recursive: true });
    const temp = `${this.stateFile}.tmp`;
    await writeFile(temp, JSON.stringify(this.data), { mode: 0o600 });
    await rename(temp, this.stateFile);
    this.storageError = false;
  }
  target(binding = this.data.binding) { return `http://127.0.0.1:${binding.backendPort}${ingress}${this.data.gatewayToken}/`; }
  owns(config, status) {
    const b = this.data.binding;
    if (!b || status.Self?.ID !== b.nodeId || status.Self?.DNSName?.replace(/\.$/, "") !== b.hostname) return false;
    if (this.backendPort && this.backendPort() !== b.backendPort) return false;
    const key = `${b.hostname}:${b.httpsPort}`;
    return config.TCP?.[b.httpsPort]?.HTTPS === true && config.Web?.[key]?.Handlers?.["/"]?.Proxy === this.target()
      && !config.AllowFunnel?.[key] && !configs(config).slice(1).some(item => occupied(item, b.httpsPort));
  }
  async inspect(force = false) {
    if (this.mutating) return this.snapshot();
    if (!force && this.checked && this.now() - this.checked < 5000) return this.snapshot();
    if (this.probing) return this.probing;
    this.probing = this.probe().finally(() => { this.probing = null; });
    return this.probing;
  }
  async probe() {
    this.checked = this.now();
    this.config = null; this.machine = null;
    try {
      this.file = await this.discover();
      if (!this.file) return this.show("not-installed");
      let output;
      try { output = await this.run(this.file, ["status", "--json"]); }
      catch (error) { if (!error.stdout) throw error; output = error; }
      this.machine = JSON.parse(output.stdout);
      const machine = this.machine;
      if (machine.BackendState === "NeedsLogin") return this.show("needs-login");
      if (machine.BackendState === "NeedsMachineAuth") return this.show("needs-approval");
      if (machine.BackendState !== "Running") return this.show("not-running");
      if (!machine.Self?.Online) return this.show("offline");
      if (!machine.Self.ID || !/^[a-z0-9.-]+\.ts\.net\.?$/.test(machine.Self.DNSName ?? "")) return this.show("error");
      this.config = JSON.parse((await this.run(this.file, ["serve", "status", "--json"])).stdout) ?? {};
      if (this.storageError) return this.show("error");
      if (!this.data.enabled) return this.setupFailure ? this.show(this.setupFailure.state, { consentUrl: this.setupFailure.consentUrl ?? null }) : this.show(this.data.binding ? "disabled" : "not-configured");
      if (!this.owns(this.config, machine)) return this.show("configuration-changed");
      this.verified = this.now();
      const b = this.data.binding;
      return this.show("ready", { url: `https://${b.hostname}${b.httpsPort === 443 ? "" : `:${b.httpsPort}`}` });
    } catch { return this.show("error"); }
  }
  serialize(action) {
    const operation = this.queue.then(async () => {
      this.mutating = true;
      try { if (this.probing) await this.probing; return await action(); }
      finally { this.mutating = false; }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  prepare(backendPort) { return this.serialize(async () => {
    if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535) return this.show("error");
    this.setupFailure = null;
    await this.probe();
    if (!["not-configured", "disabled", "ready", "configuration-changed", "needs-consent", "error"].includes(this.view.state) || !this.config || this.machine?.BackendState !== "Running" || !this.machine.Self?.Online) return this.snapshot();
    // Reuse only an exactly owned route. A changed configuration is never overwritten.
    const owned = this.owns(this.config, this.machine);
    const httpsPort = owned ? this.data.binding.httpsPort : [443, 8443, 9443].find(port => !occupied(this.config, port));
    if (!httpsPort) { this.setupFailure = { state: "port-conflict" }; return this.show("port-conflict"); }
    try {
      this.data.enabled = false; this.verified = 0;
      this.show("preparing");
      this.data.binding = { nodeId: this.machine.Self.ID, hostname: this.machine.Self.DNSName.replace(/\.$/, ""), httpsPort, backendPort };
      await this.persist();
      await this.run(this.file, ["serve", "--bg", `--https=${httpsPort}`, "--set-path=/", this.target()]);
      this.data.enabled = true;
      const result = await this.probe();
      if (result.state !== "ready") this.data.enabled = false;
      await this.persist();
      return this.snapshot();
    } catch (error) {
      this.data.enabled = false; this.verified = 0;
      const consentUrl = consentFrom(error);
      this.setupFailure = { state: consentUrl ? "needs-consent" : "error", consentUrl };
      return this.show(consentUrl ? "needs-consent" : "error", { consentUrl });
    }
  }); }
  disable() { return this.serialize(async () => {
    this.setupFailure = null;
    this.data.enabled = false; this.verified = 0;
    this.show("disabled");
    await this.persist();
    await this.probe();
    const b = this.data.binding;
    if (this.config && this.owns(this.config, this.machine) && Object.keys(this.config.Web?.[`${b.hostname}:${b.httpsPort}`]?.Handlers ?? {}).length === 1) {
      try { await this.run(this.file, ["serve", "--bg", `--https=${b.httpsPort}`, "--set-path=/", "off"]); await this.probe(); } catch { return this.show("cleanup-needed"); }
    }
    if (b && (!this.config || occupied(this.config, b.httpsPort))) return this.show("cleanup-needed");
    return this.show("disabled");
  }); }
  async openClient() {
    const file = await this.discover();
    if (!file) return this.show("not-installed");
    try { await this.open(file); } catch { throw Object.assign(new Error("请从系统托盘打开 Tailscale，连接后重新检查。"), { status: 503 }); }
    return this.snapshot();
  }
  resolveRequest(req) {
    if (req[context]) return req[context];
    if (!req.url?.startsWith(ingress)) return null;
    const deny = () => (req[context] = { kind: "denied" });
    if (!this.data.enabled || this.view.state !== "ready" || !this.verified || this.now() - this.verified > 30_000 || !loopback(req.socket.remoteAddress) || (this.backendPort && this.backendPort() !== this.data.binding?.backendPort)) return deny();
    const expected = `${ingress}${this.data.gatewayToken}/`;
    const actual = Buffer.from(req.url.slice(0, expected.length));
    const expectedBytes = Buffer.from(expected);
    if (actual.length !== expectedBytes.length || !timingSafeEqual(actual, expectedBytes)) return deny();
    const origin = this.view.url;
    const host = new URL(origin).host;
    if (req.headers.host !== host || req.headers["x-forwarded-host"] !== host || req.headers["x-forwarded-proto"] !== "https" || !req.headers["tailscale-user-login"] || req.headers["tailscale-funnel-request"] !== undefined) return deny();
    req.url = "/" + req.url.slice(expected.length);
    if (req.originalUrl?.startsWith(expected)) req.originalUrl = "/" + req.originalUrl.slice(expected.length);
    return (req[context] = { kind: "tailscale", origin });
  }
}
