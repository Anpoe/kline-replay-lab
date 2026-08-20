import assert from "node:assert/strict";
import test from "node:test";

import { createReviewGateway } from "../app/features/review/reviewGateway.ts";

function response({ ok = true, payload = {} } = {}) {
  return {
    ok,
    async json() {
      return payload;
    },
  };
}

test("loads sessions through the existing list endpoints", async () => {
  const requests = [];
  const gateway = createReviewGateway(async (input, init) => {
    requests.push({ input, init });
    return response({ payload: { sessions: [{ id: "session-1" }] } });
  });

  assert.deepEqual(await gateway.loadSessions(), [{ id: "session-1" }]);
  assert.deepEqual(await gateway.loadSessions(true), [{ id: "session-1" }]);
  assert.equal(requests[0].input, "/api/sessions");
  assert.deepEqual(requests[0].init, {});
  assert.equal(requests[1].input, "/api/sessions?all=1");
});

test("preserves session save, restore, and permanent-delete request shapes", async () => {
  const requests = [];
  const gateway = createReviewGateway(async (input, init) => {
    requests.push({ input, init });
    return response({ payload: {} });
  });
  const session = { id: "session-1", instrumentId: "600519.SH", timeframe: "1d", state: { cursor: 4 } };

  await gateway.saveSession(session);
  await gateway.restoreSession("session-1");
  await gateway.deleteSession("session-1");
  await gateway.deleteSession("session-1", true);

  assert.deepEqual(requests[0], {
    input: "/api/sessions",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(session),
    },
  });
  assert.deepEqual(requests[1], {
    input: "/api/sessions?id=session-1",
    init: {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "restore" }),
    },
  });
  assert.equal(requests[2].input, "/api/sessions?id=session-1");
  assert.equal(requests[2].init.method, "DELETE");
  assert.equal(requests[3].input, "/api/sessions?id=session-1&permanent=1");
  assert.equal(requests[3].init.method, "DELETE");
});

test("loads trash sessions and snapshot analysis with stable errors", async () => {
  const requests = [];
  const gateway = createReviewGateway(async (input, init) => {
    requests.push({ input, init });
    if (input.startsWith("/api/sessions?trash")) return response({ payload: { sessions: [{ id: "trash-1" }] } });
    if (input.startsWith("/api/snapshots?")) return response({ payload: { snapshot: { id: "snapshot-1" } } });
    if (input === "/api/snapshots/analysis") return response({ payload: { contexts: { "trade-1": {} } } });
    return response({ ok: false, payload: { error: "server unavailable" } });
  });

  assert.deepEqual(await gateway.loadTrashSessions(), [{ id: "trash-1" }]);
  assert.deepEqual(
    await gateway.loadSnapshot("snapshot-1", { startTimestamp: 100, endTimestamp: 200, lookbackBars: 30 }),
    { snapshot: { id: "snapshot-1" } },
  );
  assert.deepEqual(await gateway.loadSnapshotAnalysis([{ snapshotId: "snapshot-1", entryTimestamps: [100] }]), {
    contexts: { "trade-1": {} },
  });
  await assert.rejects(() => gateway.saveSession({}), { message: "保存训练记录失败" });
  assert.equal(requests[0].input, "/api/sessions?trash=1&all=1");
  assert.equal(requests[0].init.cache, "no-store");
  assert.match(requests[1].input, /^\/api\/snapshots\?id=snapshot-1&startTimestamp=100&endTimestamp=200&lookbackBars=30$/);
  assert.equal(requests[2].init.signal, undefined);
});
