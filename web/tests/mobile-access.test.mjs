import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MobileAccess, isLocalAdmin, isPrivateAddress, listLanAddresses } from "../server/mobile-access.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "kline-mobile-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let clock = 1_800_000_000_000;
  const options = { stateFile: path.join(root, "mobile-access.json"), now: () => clock };
  const service = await new MobileAccess(options).init();
  return { service, options, advance: (ms) => { clock += ms; } };
}

test("fresh install is disabled and only exposes private non-loopback addresses", async (t) => {
  const { service } = await fixture(t);
  assert.equal(service.status().enabled, false);
  assert.equal(service.authorize("anything"), false);
  assert.deepEqual(listLanAddresses({ WiFi: [{ address: "192.168.1.4", family: "IPv4", internal: false }, { address: "8.8.8.8", family: "IPv4", internal: false }], Loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }] }), [{ name: "WiFi", address: "192.168.1.4" }]);
  for (const value of ["10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.0.2", "::ffff:192.168.1.2"]) assert.equal(isPrivateAddress(value), true, value);
  for (const value of ["172.32.0.1", "127.0.0.1", "192.168.1.999", "192.168.1.2.evil", "8.8.8.8", "2001:4860::1"]) assert.equal(isPrivateAddress(value), false, value);
});

test("admin trust requires both a loopback socket and loopback Host, ignoring forwarded headers", () => {
  const req = (ip, host) => ({ socket: { remoteAddress: ip }, headers: { host, "x-forwarded-for": "127.0.0.1", "x-forwarded-host": "localhost:3101" } });
  assert.equal(isLocalAdmin(req("::ffff:127.0.0.1", "localhost:3101")), true);
  assert.equal(isLocalAdmin(req("::1", "[::1]:3101")), true);
  assert.equal(isLocalAdmin(req("192.168.1.5", "localhost:3101")), false);
  assert.equal(isLocalAdmin(req("127.0.0.1", "attacker.example:3101")), false);
  assert.equal(isLocalAdmin(req("127.0.0.1", "192.168.1.4:3101")), false);
});

test("scan, computer approval and claim are all required; codes are single-use", async (t) => {
  const { service } = await fixture(t);
  await assert.rejects(service.setEnabled(false).then(() => service.pair("bad", "Phone")), /未开启/);
  await service.setEnabled(true);
  const challenge = service.rotateChallenge();
  assert.throws(() => service.pair("中".repeat(challenge.code.length), "Phone"), /二维码/);
  const request = service.pair(challenge.code, "我的手机");
  assert.match(request.number, /^\d{6}$/);
  assert.equal(service.authorize(request.secret), false);
  assert.equal((await service.claim(request.id, request.secret)).status, "pending");
  assert.throws(() => service.pair(challenge.code, "other"), /二维码/);
  assert.throws(() => service.approve(request.id, "000000-wrong"), /核对码/);
  service.approve(request.id, request.number);
  assert.equal((await service.claim(request.id, request.secret)).status, "approved");
  assert.equal(service.authorize(request.secret), true);
  assert.equal((await service.claim(request.id, request.secret)).status, "approved", "lost responses can retry the same claim");
  assert.equal(service.status().devices.length, 1);
});

test("device hashes survive restart, disabled access pauses authorization and revocation persists", async (t) => {
  const { service, options } = await fixture(t);
  await service.setEnabled(true);
  const request = service.pair(service.rotateChallenge().code, "Phone");
  service.approve(request.id, request.number);
  await service.claim(request.id, request.secret);
  const disk = await readFile(options.stateFile, "utf8");
  assert.ok(!disk.includes(request.secret));
  assert.ok(!JSON.stringify(service.status()).includes(request.secret));
  const restarted = await new MobileAccess(options).init();
  assert.equal(restarted.authorize(request.secret), true);
  await restarted.setEnabled(false);
  assert.equal(restarted.authorize(request.secret), false);
  await restarted.setEnabled(true);
  assert.equal(restarted.authorize(request.secret), true);
  await restarted.revoke(restarted.status().devices[0].id);
  assert.equal(restarted.authorize(request.secret), false);
  assert.equal((await new MobileAccess(options).init()).authorize(request.secret), false);
  await assert.rejects(restarted.claim(request.id, request.secret));
});

test("rotation, expiration, denial, wrong secret and disabling cancel pending requests", async (t) => {
  const { service, advance } = await fixture(t);
  await service.setEnabled(true);
  const old = service.rotateChallenge();
  const fresh = service.rotateChallenge();
  assert.throws(() => service.pair(old.code, "Phone"), /二维码/);
  advance(300_001);
  assert.throws(() => service.pair(fresh.code, "Phone"), /二维码/);
  const request = service.pair(service.rotateChallenge().code, "Phone");
  await assert.rejects(service.claim(request.id, "wrong"), /重新扫码/);
  service.deny(request.id);
  assert.equal((await service.claim(request.id, request.secret)).status, "denied");
  const expired = service.pair(service.rotateChallenge().code, "Phone");
  advance(300_001);
  assert.throws(() => service.approve(expired.id, expired.number), /过期/);
  const cancelled = service.pair(service.rotateChallenge().code, "Phone");
  await service.setEnabled(false);
  await service.setEnabled(true);
  await assert.rejects(service.claim(cancelled.id, cancelled.secret), /重新扫码/);
});

test("authorization expires and concurrent approvals retain both devices", async (t) => {
  const { service, advance } = await fixture(t);
  await service.setEnabled(true);
  const first = service.pair(service.rotateChallenge().code, "One");
  const second = service.pair(service.rotateChallenge().code, "Two");
  service.approve(first.id, first.number);
  service.approve(second.id, second.number);
  await Promise.all([service.claim(first.id, first.secret), service.claim(second.id, second.secret)]);
  assert.equal(service.status().devices.length, 2);
  advance(30 * 86400_000 + 1);
  assert.equal(service.authorize(first.secret), false);
  assert.equal(service.authorize(second.secret), false);
});

test("corrupt state and failed writes fail closed with a recoverable status", async (t) => {
  const { service, options } = await fixture(t);
  await writeFile(options.stateFile, "{broken");
  const broken = await new MobileAccess(options).init();
  assert.equal(broken.status().enabled, false);
  assert.match(broken.status().storageError, /重新开启/);
  await broken.setEnabled(true);
  assert.equal(broken.status().storageError, "");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(options.stateFile + ".tmp");
  await assert.rejects(service.setEnabled(true));
  assert.equal(service.status().enabled, false, "a failed save cannot enable access");
});
