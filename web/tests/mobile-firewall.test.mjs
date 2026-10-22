import assert from "node:assert/strict";
import test from "node:test";
import { mobileFirewallCommand } from "../server/mobile-firewall.mjs";

test("firewall action hides shells, requires Windows authorization and only allows private local-subnet connections", () => {
  const command = mobileFirewallCommand(3101, "C:\\Users\\O'Brien\\runtime\\node.exe");
  assert.equal(command.options.windowsHide, true);
  assert.deepEqual(command.args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
  const wrapper = Buffer.from(command.args[3], "base64").toString("utf16le");
  assert.match(wrapper, /-Verb RunAs -WindowStyle Hidden -Wait -PassThru/);
  const encoded = wrapper.match(/'-EncodedCommand','([A-Za-z0-9+/=]+)'/)[1];
  const elevated = Buffer.from(encoded, "base64").toString("utf16le");
  assert.match(elevated, /-Profile Private -Protocol TCP -LocalPort 3101 -RemoteAddress LocalSubnet/);
  assert.match(elevated, /O''Brien/);
  assert.doesNotMatch(elevated, /-Profile (Any|Public)|-RemoteAddress Any/);
  assert.throws(() => mobileFirewallCommand("3101;bad"));
  assert.throws(() => mobileFirewallCommand(65536));
});
