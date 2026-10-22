import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";

const PAIR_TTL = 5 * 60_000;
export const DEVICE_TTL = 30 * 86400_000;
export const mobileCookie = "kline_mobile";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const same = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const ensure = (condition, message, status = 400) => { if (!condition) throw Object.assign(new Error(message), { status }); };
const ipv4 = (value = "") => value.replace(/^::ffff:/, "");

export function isPrivateAddress(input) {
  const address = ipv4(input);
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function isLocalAdmin(req) {
  const peer = ipv4(req.socket.remoteAddress);
  if (!(peer === "::1" || (isIP(peer) === 4 && peer.startsWith("127.")))) return false;
  try {
    const host = new URL(`http://${req.headers.host}`).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch { return false; }
}

export function listLanAddresses(interfaces = networkInterfaces()) {
  const seen = new Set();
  return Object.entries(interfaces).flatMap(([name, values]) => (values ?? []).flatMap((item) => {
    if (item.internal || item.family !== "IPv4" || !isPrivateAddress(item.address) || seen.has(item.address)) return [];
    seen.add(item.address);
    return [{ name, address: item.address }];
  }));
}

/** Independent access settings. Training data, snapshots and account state never enter this store. */
export class MobileAccess {
  constructor({ stateFile, now = Date.now }) {
    this.stateFile = stateFile;
    this.now = now;
    this.state = { version: 1, enabled: false, devices: [] };
    this.pending = new Map();
    this.challenge = null;
    this.storageError = "";
    this.serial = Promise.resolve();
    this.adminToken = secret();
  }

  async init() {
    try {
      const parsed = JSON.parse(await readFile(this.stateFile, "utf8"));
      ensure(parsed.version === 1 && typeof parsed.enabled === "boolean" && Array.isArray(parsed.devices) && parsed.devices.length <= 50, "invalid state");
      ensure(parsed.devices.every((d) => typeof d.id === "string" && typeof d.name === "string" && d.name.length <= 40 && /^[a-f0-9]{64}$/.test(d.tokenHash) && Number.isFinite(d.createdAt) && Number.isFinite(d.expiresAt)), "invalid devices");
      this.state = parsed;
    } catch (error) {
      if (error.code !== "ENOENT") this.storageError = "手机授权记录无法读取，访问已关闭。请在电脑上重新开启并配对。";
    }
    return this;
  }

  status() {
    this.prune();
    return {
      enabled: this.state.enabled,
      storageError: this.storageError,
      challenge: this.challenge,
      pending: [...this.pending.values()].filter((p) => p.status === "pending").map(({ id, name, number, expiresAt }) => ({ id, name, number, expiresAt })),
      devices: this.state.devices.map(({ id, name, createdAt, expiresAt }) => ({ id, name, createdAt, expiresAt, expired: expiresAt <= this.now() })),
    };
  }

  prune() {
    if (this.challenge?.expiresAt <= this.now()) this.challenge = null;
    for (const [id, request] of this.pending) if (request.expiresAt <= this.now()) this.pending.delete(id);
  }

  async transaction(update) {
    const task = this.serial.then(async () => {
      const next = await update(structuredClone(this.state));
      try {
        await mkdir(path.dirname(this.stateFile), { recursive: true });
        await writeFile(this.stateFile + ".tmp", JSON.stringify(next), { mode: 0o600 });
        await rename(this.stateFile + ".tmp", this.stateFile);
      } catch {
        this.storageError = "手机访问设置未能保存，请检查程序文件夹可写后重试。";
        throw Object.assign(new Error(this.storageError), { status: 503 });
      }
      this.state = next;
      this.storageError = "";
    });
    this.serial = task.catch(() => {});
    return task;
  }

  async setEnabled(enabled) {
    ensure(typeof enabled === "boolean", "请选择开启或关闭手机访问。");
    await this.transaction((state) => ({ ...state, enabled }));
    if (!enabled) { this.challenge = null; this.pending.clear(); }
  }

  rotateChallenge() {
    ensure(this.state.enabled, "手机访问未开启，请在电脑上开启。", 403);
    this.challenge = { code: secret(), expiresAt: this.now() + PAIR_TTL };
    return this.challenge;
  }

  pair(code, name) {
    this.prune();
    ensure(this.state.enabled, "手机访问未开启，请在电脑上开启。", 403);
    ensure(this.challenge && same(code, this.challenge.code), "二维码已使用或过期，请在电脑上刷新二维码后重新扫码。", 410);
    ensure(typeof name === "string" && name.trim().length > 0 && name.trim().length <= 40 && !/[\x00-\x1f\x7f]/.test(name), "请填写 1–40 字的设备名称。");
    ensure(this.pending.size < 20 && this.state.devices.length < 50, "配对设备过多，请在电脑上清理后重试。", 429);
    const token = secret();
    const request = { id: randomUUID(), name: name.trim(), number: String(randomInt(1_000_000)).padStart(6, "0"), secretHash: hash(token), expiresAt: this.now() + PAIR_TTL, status: "pending" };
    this.pending.set(request.id, request);
    this.challenge = null;
    return { id: request.id, secret: token, number: request.number, expiresAt: request.expiresAt };
  }

  approve(id, number) {
    this.prune();
    const request = this.pending.get(id);
    ensure(this.state.enabled && request?.status === "pending", "配对请求已过期，请让手机重新扫码。", 410);
    ensure(same(request.number, number), "核对码不一致，请刷新配对列表。", 409);
    request.status = "approved";
  }

  deny(id) {
    const request = this.pending.get(id);
    ensure(request?.status === "pending", "配对请求已结束，请刷新列表。", 410);
    request.status = "denied";
  }

  async claim(id, token) {
    this.prune();
    const request = this.pending.get(id);
    ensure(this.state.enabled && typeof token === "string" && token.length <= 100 && request && same(request.secretHash, hash(token)), "配对已结束，请在电脑上刷新二维码后重新扫码。", 410);
    if (request.status === "pending" || request.status === "denied") return { status: request.status };
    await this.transaction((state) => {
      ensure(state.enabled && this.pending.get(id) === request, "配对已结束，请重新扫码。", 410);
      if (!request.claimed && !state.devices.some((d) => d.id === id)) {
        ensure(state.devices.length < 50, "授权设备过多，请在电脑上清理后重试。", 429);
        state.devices.push({ id: request.id, name: request.name, tokenHash: request.secretHash, createdAt: this.now(), expiresAt: this.now() + DEVICE_TTL });
      } else ensure(state.devices.some((d) => d.id === id), "授权已撤销，请重新扫码。", 403);
      return state;
    });
    request.claimed = true;
    return { status: "approved", token };
  }

  authorize(token) {
    if (!this.state.enabled || typeof token !== "string" || token.length > 100) return false;
    const digest = hash(token);
    return this.state.devices.some((device) => device.expiresAt > this.now() && same(device.tokenHash, digest));
  }

  async revoke(id) {
    await this.transaction((state) => ({ ...state, devices: state.devices.filter((device) => device.id !== id) }));
    this.pending.delete(id);
  }
}
