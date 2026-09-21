import { ensureSchema, getRawDb } from "../../../db/runtime";
import {
  mergeHiddenBuiltInPatternPresets,
  PATTERN_PRESET_RESTORE_ACTION,
} from "../../lib/patternPresetPersistence";

const PREFERENCES_KEY = "training_preferences_v1";
const MAX_PREFERENCES_BYTES = 2 * 1024 * 1024;
const MAX_SAVE_ATTEMPTS = 8;

function withoutLegacyLiveState(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const preferences = { ...(value as Record<string, unknown>) };
  delete preferences.livePortfolios;
  delete preferences.liveWatchlist;
  delete preferences.patternPresetAction;
  return preferences;
}

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
      { preferences: withoutLegacyLiveState(JSON.parse(row.value)) },
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

  const allowPatternPresetRestore = (preferences as { patternPresetAction?: unknown }).patternPresetAction
    === PATTERN_PRESET_RESTORE_ACTION;
  const db = getRawDb();
  for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
    const existingRow = await db
      .prepare("SELECT value FROM app_metadata WHERE key = ?")
      .bind(PREFERENCES_KEY)
      .first<{ value: string }>();
    let existingPreferences: unknown = null;
    if (existingRow?.value) {
      try {
        existingPreferences = JSON.parse(existingRow.value);
      } catch {
        existingPreferences = null;
      }
    }
    const value = JSON.stringify(mergeHiddenBuiltInPatternPresets(
      withoutLegacyLiveState(preferences),
      existingPreferences,
      allowPatternPresetRestore,
    ));
    if (new TextEncoder().encode(value).byteLength > MAX_PREFERENCES_BYTES) {
      return Response.json({ error: "设置内容过大" }, { status: 413 });
    }

    // Merge and write must refer to the same stored value. Another window may
    // save between the SELECT and this statement; reload its hidden flags on
    // conflict instead of replacing them with a merge against the old row.
    const result = existingRow
      ? await db.prepare("UPDATE app_metadata SET value = ? WHERE key = ? AND value = ?")
        .bind(value, PREFERENCES_KEY, existingRow.value).run()
      : await db.prepare("INSERT INTO app_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING")
        .bind(PREFERENCES_KEY, value).run();
    if (result.meta.changes > 0) return Response.json({ saved: true });
  }
  return Response.json({ error: "设置正在其他窗口中保存，请稍后重试" }, { status: 409 });
}
