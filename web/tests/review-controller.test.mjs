import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReviewSessionSummariesInBatches,
  createReviewRestoreRequest,
  filterReviewSessions,
  hasMeaningfulTrainingActivity,
  nextReviewSessionVisibleCount,
  normalizeReviewError,
  visibleReviewSessionItems,
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

test("复盘摘要分批构建保持顺序并在批次之间让出执行权", async () => {
  const yields = [];
  const result = await buildReviewSessionSummariesInBatches(
    [1, 2, 3, 4, 5],
    (value) => value === 3 ? null : `summary-${value}`,
    {
      batchSize: 2,
      yieldToBrowser: async () => yields.push(yields.length + 1),
    },
  );

  assert.deepEqual(result, {
    status: "completed",
    summaries: ["summary-1", "summary-2", "summary-4", "summary-5"],
  });
  assert.equal(yields.length, 2);
});

test("复盘摘要构建被取消时返回部分结果且不标记为完成", async () => {
  let cancelled = false;
  const result = await buildReviewSessionSummariesInBatches(
    [1, 2, 3, 4],
    (value) => `summary-${value}`,
    {
      batchSize: 2,
      shouldCancel: () => cancelled,
      yieldToBrowser: async () => {
        cancelled = true;
      },
    },
  );

  assert.deepEqual(result, {
    status: "cancelled",
    summaries: ["summary-1", "summary-2"],
  });
});

test("复盘列表按页递增并保留当前选中的历史记录", () => {
  const items = Array.from({ length: 120 }, (_, index) => ({
    id: `session-${index + 1}`,
    selected: index === 99,
  }));

  assert.equal(nextReviewSessionVisibleCount(50, items.length), 100);
  assert.equal(nextReviewSessionVisibleCount(100, items.length), 120);
  assert.deepEqual(
    visibleReviewSessionItems(items, 50).map((item) => item.id),
    [...Array.from({ length: 50 }, (_, index) => `session-${index + 1}`), "session-100"],
  );
});

test("训练清理判定忽略只看K线，但保留真实操作和决策记录", () => {
  const empty = {
    positions: [],
    pendingOrders: [],
    executions: [],
    orderRejections: [],
    drawings: [],
    hasDecisionContent: false,
    events: [{ type: "session_created" }, { type: "replay_advanced" }, { type: "training_completed" }],
  };

  assert.equal(hasMeaningfulTrainingActivity(empty), false);
  assert.equal(hasMeaningfulTrainingActivity({ ...empty, hasDecisionContent: true }), true);
  assert.equal(hasMeaningfulTrainingActivity({ ...empty, drawings: [{ id: "drawing-1" }] }), true);
  assert.equal(hasMeaningfulTrainingActivity({ ...empty, positions: [{ id: "position-1" }] }), true);
  assert.equal(hasMeaningfulTrainingActivity({ ...empty, events: [{ type: "drawings_changed" }] }), true);
  assert.equal(hasMeaningfulTrainingActivity({ ...empty, events: [{ type: "decision_deleted" }] }), true);
  assert.equal(hasMeaningfulTrainingActivity({ ...empty, events: [{ type: "unknown_legacy_action" }] }), true);
  assert.equal(hasMeaningfulTrainingActivity({ ...empty, events: [null] }), true);
});
