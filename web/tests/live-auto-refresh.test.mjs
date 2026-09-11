import assert from "node:assert/strict";
import test from "node:test";

import { shouldRefreshLivePricesAfterAutoUpdate } from "../app/features/live/liveAutoRefresh.ts";

test("only refreshes live prices after a newer completed background run", () => {
  assert.equal(shouldRefreshLivePricesAfterAutoUpdate(undefined, {
    lastFinishedAt: "2026-09-10T06:19:18.503Z",
    lastStatus: "completed",
  }), false);
  assert.equal(shouldRefreshLivePricesAfterAutoUpdate("2026-09-10T06:19:18.503Z", {
    lastFinishedAt: "2026-09-10T06:19:18.503Z",
    lastStatus: "completed",
  }), false);
  assert.equal(shouldRefreshLivePricesAfterAutoUpdate(null, {
    lastFinishedAt: "2026-09-10T06:19:18.503Z",
    lastStatus: "completed",
  }), true);
  assert.equal(shouldRefreshLivePricesAfterAutoUpdate("2026-09-10T06:19:18.503Z", {
    lastFinishedAt: "2026-09-10T06:20:18.503Z",
    lastStatus: "partial",
  }), true);
  assert.equal(shouldRefreshLivePricesAfterAutoUpdate("2026-09-10T06:19:18.503Z", {
    lastFinishedAt: "2026-09-10T06:20:18.503Z",
    lastStatus: "running",
  }), false);
  assert.equal(shouldRefreshLivePricesAfterAutoUpdate("2026-09-10T06:19:18.503Z", {
    lastFinishedAt: "2026-09-10T06:20:18.503Z",
    lastStatus: "failed",
  }), false);
});
