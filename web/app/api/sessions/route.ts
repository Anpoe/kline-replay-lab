import { ensureSchema, getRawDb } from "../../../db/runtime";

type SessionEventPayload = {
  id?: string;
  sequence?: number;
  type?: string;
  barTimestamp?: number;
  payload?: unknown;
  occurredAt?: string;
};

type SessionEventRow = {
  id: string;
  sequence: number;
  type: string;
  barTimestamp: number | null;
  payloadJson: string;
  occurredAt: string;
};

export async function GET(request: Request) {
  await ensureSchema();
  const db = getRawDb();
  const searchParams = new URL(request.url).searchParams;
  const id = searchParams.get("id");
  const includeTrash = searchParams.get("trash") === "1";
  const visibilityClause = includeTrash ? "deleted_at IS NOT NULL" : "deleted_at IS NULL";
  if (id) {
    const session = await db
      .prepare(`SELECT id, instrument_id AS instrumentId, timeframe,
        data_snapshot_id AS dataSnapshotId, state_json AS stateJson,
        created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
        FROM training_sessions WHERE id = ? AND ${visibilityClause}`)
      .bind(id)
      .first();
    if (!session) return Response.json({ error: "训练记录不存在" }, { status: 404 });
    const events = await db
      .prepare(`SELECT event_id AS id, sequence, event_type AS type,
        bar_timestamp AS barTimestamp, payload_json AS payloadJson,
        occurred_at AS occurredAt
      FROM session_events WHERE session_id = ? ORDER BY sequence ASC`)
      .bind(id)
      .all();
    const normalizedEvents = (events.results as unknown as SessionEventRow[]).map((event) => ({
      id: event.id,
      sequence: event.sequence,
      type: event.type,
      barTimestamp: event.barTimestamp,
      payload: JSON.parse(event.payloadJson),
      occurredAt: event.occurredAt,
    }));
    return Response.json({ session, events: normalizedEvents });
  }

  const includeAll = searchParams.get("all") === "1";
  const rows = await db
    .prepare(`SELECT id, instrument_id AS instrumentId, timeframe,
      data_snapshot_id AS dataSnapshotId, state_json AS stateJson,
      created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM training_sessions WHERE ${visibilityClause}
      ORDER BY updated_at DESC${includeAll ? "" : " LIMIT 20"}`)
    .all();
  return Response.json({ sessions: rows.results });
}

export async function POST(request: Request) {
  await ensureSchema();
  const payload = (await request.json()) as {
    id?: string;
    instrumentId?: string;
    timeframe?: string;
    dataSnapshotId?: string;
    state?: { events?: SessionEventPayload[] } & Record<string, unknown>;
  };
  if (!payload.id || !payload.instrumentId || !payload.timeframe || payload.state == null) {
    return Response.json({ error: "训练记录不完整" }, { status: 400 });
  }
  const now = new Date().toISOString();
  const db = getRawDb();
  await db
    .prepare(`INSERT INTO training_sessions
      (id, instrument_id, timeframe, data_snapshot_id, state_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json,
      instrument_id = excluded.instrument_id, timeframe = excluded.timeframe,
      data_snapshot_id = excluded.data_snapshot_id,
      updated_at = excluded.updated_at`)
    .bind(
      payload.id,
      payload.instrumentId,
      payload.timeframe,
      payload.dataSnapshotId ?? null,
      JSON.stringify(payload.state),
      now,
      now,
    )
    .run();

  const events = (payload.state.events ?? []).filter((event) =>
    event.id && Number.isInteger(event.sequence) && event.type && event.occurredAt);
  for (let index = 0; index < events.length; index += 80) {
    await db.batch(events.slice(index, index + 80).map((event) =>
      db.prepare(`INSERT OR IGNORE INTO session_events
        (event_id, session_id, sequence, event_type, bar_timestamp, payload_json, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          event.id,
          payload.id,
          event.sequence,
          event.type,
          event.barTimestamp ?? null,
          JSON.stringify(event.payload ?? {}),
          event.occurredAt,
        )));
  }
  return Response.json({ id: payload.id, savedAt: now });
}

export async function PATCH(request: Request) {
  await ensureSchema();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "缺少训练记录 ID" }, { status: 400 });
  const payload = (await request.json().catch(() => ({}))) as { action?: string };
  if (payload.action !== "restore") {
    return Response.json({ error: "不支持的训练记录操作" }, { status: 400 });
  }
  const now = new Date().toISOString();
  const db = getRawDb();
  const existing = await db
    .prepare("SELECT id FROM training_sessions WHERE id = ? AND deleted_at IS NOT NULL")
    .bind(id)
    .first();
  if (!existing) return Response.json({ error: "回收站中不存在这条训练记录" }, { status: 404 });
  await db
    .prepare("UPDATE training_sessions SET deleted_at = NULL, updated_at = ? WHERE id = ?")
    .bind(now, id)
    .run();
  return Response.json({ id, restored: true, restoredAt: now });
}

export async function DELETE(request: Request) {
  await ensureSchema();
  const searchParams = new URL(request.url).searchParams;
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "缺少训练记录 ID" }, { status: 400 });
  const db = getRawDb();
  const permanently = searchParams.get("permanent") === "1";
  const exists = await db.prepare("SELECT id FROM training_sessions WHERE id = ?").bind(id).first();
  if (!exists) return Response.json({ error: "训练记录不存在" }, { status: 404 });
  if (!permanently) {
    const now = new Date().toISOString();
    await db
      .prepare("UPDATE training_sessions SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
      .bind(now, id)
      .run();
    return Response.json({ id, deleted: true, movedToTrash: true, deletedAt: now });
  }
  await db.batch([
    db.prepare("DELETE FROM session_events WHERE session_id = ?").bind(id),
    db.prepare("DELETE FROM training_sessions WHERE id = ?").bind(id),
  ]);
  return Response.json({ id, deleted: true, permanentlyDeleted: true });
}
