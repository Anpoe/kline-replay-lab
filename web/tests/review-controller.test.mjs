import assert from "node:assert/strict";
import test from "node:test";

import {
  createReviewRestoreRequest,
  filterReviewSessions,
  normalizeReviewError,
} from "../app/features/review/reviewController.ts";

const sessions = [
  { id: "completed-plan", instrumentId: "600519.SH", timeframe: "1d", modeLabel: "随机训练", completed: true, hasPlan: true, patternNames: ["突破"] },
  { id: "active-no-plan", instrumentId: "AAPL", timeframe: "1h", modeLabel: "自由训练", completed: false, hasPlan: false, patternNames: [] },
];

test("复盘筛选只依赖标准化会话摘要", () => {
  assert.deepEqual(filterReviewSessions(sessions, {
    query: "突破",
    timeframe: "all",
    modeLabel: "all",
    status: "all",
    planStatus: "all",
  }).map((session) => session.id), ["completed-plan"]);
  assert.deepEqual(filterReviewSessions(sessions, {
    query: "",
    timeframe: "1h",
    modeLabel: "all",
    status: "active",
    planStatus: "unwritten",
  }).map((session) => session.id), ["active-no-plan"]);
});

test("恢复请求明确区分预览和正式恢复", () => {
  assert.deepEqual(createReviewRestoreRequest("session-1", true, 123), {
    sessionId: "session-1",
    preview: true,
    evidenceTimestamp: 123,
  });
  assert.deepEqual(createReviewRestoreRequest("session-2"), {
    sessionId: "session-2",
    preview: false,
  });
});

test("复盘错误统一为用户可见文本", () => {
  assert.equal(normalizeReviewError(new Error("恢复失败")), "恢复失败");
  assert.equal(normalizeReviewError(null), "复盘操作失败");
});
