import { ensureSchema, getRawDb } from "../../../db/runtime";

const PREFERENCES_KEY = "training_preferences_v1";
const MAX_PREFERENCES_BYTES = 256 * 1024;

export async function GET() {
  await ensureSchema();
  const row = await getRawDb()
    .prepare("SELECT value FROM app_metadata WHERE key = ?")
    .bind(PREFERENCES_KEY)
    .first<{ value: string }>();

  if (!row?.value) {
    return Response.json({ preferences: null }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    return Response.json(
      { preferences: JSON.parse(row.value) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ preferences: null }, { headers: { "Cache-Control": "no-store" } });
  }
}

export async function PUT(request: Request) {
  await ensureSchema();
  const preferences = await request.json() as unknown;
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
    return Response.json({ error: "设置内容格式不正确" }, { status: 400 });
  }

  const value = JSON.stringify(preferences);
  if (new TextEncoder().encode(value).byteLength > MAX_PREFERENCES_BYTES) {
    return Response.json({ error: "设置内容过大" }, { status: 413 });
  }

  await getRawDb()
    .prepare(`INSERT INTO app_metadata (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(PREFERENCES_KEY, value)
    .run();
  return Response.json({ saved: true });
}
