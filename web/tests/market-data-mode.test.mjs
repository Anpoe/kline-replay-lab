import assert from "node:assert/strict";
import test from "node:test";

import { chooseUsSyncMode } from "../app/features/market-data/marketDataMode.ts";

test("未完成的美股任务继续时应重新初始化，而不是只做增量更新", () => {
  assert.equal(chooseUsSyncMode({ started: true, remaining: 168 }), "initialize");
});

test("没有剩余品种且已有历史数据时才使用增量更新", () => {
  assert.equal(chooseUsSyncMode({ started: true, remaining: 0 }), "update");
});

test("尚未开始时应使用初始化模式", () => {
  assert.equal(chooseUsSyncMode({ started: false, remaining: 0 }), "initialize");
});
