import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const root = new URL("../", import.meta.url);

test("客户可见文案不暴露内部方案或调试表达", async () => {
  const result = await run(process.execPath, ["scripts/check-customer-copy.mjs"], { cwd: root });
  assert.match(result.stdout, /客户文案检查通过/);
});

test("数据功能提供从入口到配置和恢复的首次使用引导", async () => {
  const [dataManager, providerSettings] = await Promise.all([
    readFile(new URL("app/features/market-data/components/DataSourceManager.tsx", root), "utf8"),
    readFile(new URL("app/features/market-data/components/ProviderSettingsPanel.tsx", root), "utf8"),
  ]);
  assert.match(dataManager, /首次数据初始化/);
  assert.match(dataManager, /查看推荐方案/);
  assert.match(dataManager, /设置 → 数据源设置/);
  assert.match(dataManager, /请检查本机数据服务状态后重试/);
  assert.match(providerSettings, /首次使用：先确认数据服务状态/);
  assert.match(providerSettings, /保存 Tushare/);
  assert.match(providerSettings, /保存 Alpaca/);
});
