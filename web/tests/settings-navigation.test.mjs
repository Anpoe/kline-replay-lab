import assert from "node:assert/strict";
import test from "node:test";
import { findSettingsGroups, settingsCategories, settingsGroups } from "../app/features/settings/settingsNavigation.ts";

test("every settings group belongs to a discoverable category, including disabled MT4", () => {
  assert.equal(new Set(settingsGroups.map((group) => group.id)).size, settingsGroups.length);
  for (const category of settingsCategories) assert.ok(findSettingsGroups("", category.id).length);
  assert.deepEqual(findSettingsGroups("", "mt4").map((group) => group.id), ["mt4-enabled", "mt4-motion"]);
  assert.equal(findSettingsGroups("  ", "accounts").length, 3);
});

test("search locates controls across categories using familiar names", () => {
  for (const [query, expected] of [["杠杆", "fx-account"], ["手续费", "execution"], ["回收站", "trash"], ["收盘前", "mt4-motion"], ["初始资金", "training-account"], ["定时", "providers"], ["历史 K 线", "history"]]) {
    assert.ok(findSettingsGroups(query, "basic").some((group) => group.id === expected), query);
  }
});

test("search accepts case, full-width characters and multiple terms without unrelated matches", () => {
  assert.deepEqual(findSettingsGroups("  ｍｔ４ 开盘  ", "data").map((group) => group.id), ["mt4-motion"]);
  assert.deepEqual(findSettingsGroups("AlPaCa", "basic").map((group) => group.id), ["providers"]);
  assert.deepEqual(findSettingsGroups("不存在的设置", "basic"), []);
  assert.deepEqual(findSettingsGroups("杠杆 佣金", "basic"), []);
});
