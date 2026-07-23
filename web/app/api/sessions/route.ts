import { ensureSchema, getRawDb } from "../../../db/runtime";

export async function GET() {
  await ensureSchema();
  const rows = await getRawDb()
    .prepare(`SELECT id, instrument_id AS instrumentId, timeframe, state_json AS stateJson,
      created_at AS createdAt, updated_at AS updatedAt
      FROM training_sessions ORDER BY updated_at DESC LIMIT 20`)
    .all();
  return Response.json({ sessions: rows.results });
}

export async function POST(request: Request) {
  await ensureSchema();
  const payload = (await request.json()) as {
    id?: string;
    instrumentId?: string;
    timeframe?: string;
    state?: unknown;
  };
  if (!payload.id || !payload.instrumentId || !payload.timeframe || payload.state == null) {
    return Response.json({ error: "训练记录不完整" }, { status: 400 });
  }
  const now = new Date().toISOString();
  await getRawDb()
    .prepare(`INSERT INTO training_sessions
      (id, instrument_id, timeframe, state_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json,
      instrument_id = excluded.instrument_id, timeframe = excluded.timeframe,
      updated_at = excluded.updated_at`)
    .bind(payload.id, payload.instrumentId, payload.timeframe, JSON.stringify(payload.state), now, now)
    .run();
  return Response.json({ id: payload.id, savedAt: now });
}
