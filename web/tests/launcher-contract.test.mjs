import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("兼容 BAT 转交独立托盘面板", async () => {
  const [legacy, nativePanel, nativeSupervisor] = await Promise.all([
    readFile(new URL("../../启动本地网页版.bat", import.meta.url), "utf8"),
    readFile(new URL("../../launcher/NativeControlPanel.cs", import.meta.url), "utf8"),
    readFile(new URL("../../launcher/NativeProcessSupervisor.cs", import.meta.url), "utf8"),
  ]);
  const nativeSource = `${nativePanel}\n${nativeSupervisor}`;

  assert.match(legacy, /KLineTrainingCamp\.ControlPanel\.exe/i);
  assert.match(legacy, /%\*/);
  assert.doesNotMatch(legacy, /powershell(?:\.exe)?/i);
  assert.match(nativePanel, /NotifyIcon/);
  assert.match(nativeSource, /3100/);
  assert.match(nativeSource, /3101/);
  assert.match(nativeSource, /3102/);
  assert.match(nativePanel, /GetWorkerStatusAsync/);
  assert.match(nativePanel, /Environment\.SpecialFolder\.Startup/);
  assert.match(nativePanel, /--hidden/);
});

test("旧 PowerShell 控制面板已经从项目入口移除", async () => {
  const oldPanel = new URL("../../launcher/KLineControlPanel.ps1", import.meta.url);
  const legacyLauncher = await readFile(new URL("../../启动本地网页版.bat", import.meta.url), "utf8");

  await assert.rejects(() => access(oldPanel), { code: "ENOENT" });
  assert.doesNotMatch(legacyLauncher, /KLineControlPanel\.ps1|powershell(?:\.exe)?/i);
});

test("启动器保留局域网与远程地址提示且不自动开放防火墙", async () => {
  const source = await readFile(new URL("../../启动本地网页版.bat", import.meta.url), "utf8");
  assert.match(source, /KLINE_WEB_PORT=3101/);
  assert.match(source, /KLINE_MOBILE_URL/);
  assert.match(source, /KLINE_REMOTE_HOST/);
  assert.match(source, /if\s+not\s+defined\s+KLINE_REMOTE_HOST/i);
  assert.doesNotMatch(source, /kline42\.dynv6\.net/i);
  assert.match(source, /Remote \(IPv6\)/);
  assert.match(source, /same trusted Wi-Fi/);
  assert.match(source, /does not open a public firewall port automatically/);
});
