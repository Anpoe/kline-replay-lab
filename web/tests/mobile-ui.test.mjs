import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("falls back when randomUUID is unavailable on an insecure LAN origin", async () => {
  const workbench = await readFile(new URL("app/components/TrainingWorkbench.tsx", root), "utf8");

  assert.match(workbench, /typeof webCrypto\?\.randomUUID === "function"/);
  assert.match(workbench, /typeof webCrypto\?\.getRandomValues === "function"/);
  assert.match(workbench, /bytes\[6\].*0x40/);
  assert.doesNotMatch(workbench, /\bcrypto\.randomUUID\(/);
});

test("exposes the web UI to a trusted LAN while keeping mobile access discoverable", async () => {
  const [viteConfig, launcher] = await Promise.all([
    readFile(new URL("vite.config.ts", root), "utf8"),
    readFile(new URL("../启动本地网页版.bat", root), "utf8"),
  ]);

  assert.match(viteConfig, /host:\s*"0\.0\.0\.0"/);
  assert.match(launcher, /KLINE_MOBILE_URL/);
  assert.match(launcher, /Phone:/);
  assert.match(launcher, /same trusted Wi-Fi/);
});

test("supports touch long-press decision backfill without disabling chart dragging", async () => {
  const chart = await readFile(new URL("app/components/KLineReplayChart.tsx", root), "utf8");

  assert.match(chart, /event\.pointerType !== "touch"/);
  assert.match(chart, /Math\.hypot/);
  assert.match(chart, /window\.setTimeout/);
  assert.match(chart, /onPointerCancel=\{cancelLongPress\}/);
  assert.match(chart, /右键或长按已揭示的 K 线/);
});

test("uses mobile cards for wide training and data tables", async () => {
  const [styles, workbench] = await Promise.all([
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/components/TrainingWorkbench.tsx", root), "utf8"),
  ]);

  assert.match(styles, /@media \(max-width: 600px\)/);
  assert.match(styles, /\.orders-table td::before/);
  assert.match(styles, /\.performance-session-header \{ display: none; \}/);
  assert.match(styles, /\.coverage-table tbody tr \{ display: grid/);
  assert.match(styles, /\.download-job-header \{ display: none; \}/);
  assert.match(workbench, /data-label="覆盖范围"/);
  assert.match(workbench, /长按 K 线补写决策/);
});
