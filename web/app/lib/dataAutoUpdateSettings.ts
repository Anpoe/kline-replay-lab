export type DataAutoUpdateStatus = "idle" | "running" | "completed" | "partial" | "failed";

export type DataAutoUpdateSettings = {
  enabled: boolean;
  lastCheckDate: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: DataAutoUpdateStatus;
  lastMessage: string;
  lastRunToken: string | null;
};

export const DATA_AUTO_UPDATE_SETTINGS_KEY = "data_auto_update_settings_v1";

export const DEFAULT_DATA_AUTO_UPDATE_SETTINGS: DataAutoUpdateSettings = {
  enabled: false,
  lastCheckDate: null,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastStatus: "idle",
  lastMessage: "",
  lastRunToken: null,
};

function asNullableString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function asStatus(value: unknown): DataAutoUpdateStatus {
  return value === "running" || value === "completed" || value === "partial" || value === "failed"
    ? value
    : "idle";
}

export function normalizeDataAutoUpdateSettings(value: unknown): DataAutoUpdateSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_DATA_AUTO_UPDATE_SETTINGS };
  }
  const source = value as Record<string, unknown>;
  return {
    enabled: source.enabled === true,
    lastCheckDate: asNullableString(source.lastCheckDate),
    lastStartedAt: asNullableString(source.lastStartedAt),
    lastFinishedAt: asNullableString(source.lastFinishedAt),
    lastStatus: asStatus(source.lastStatus),
    lastMessage: typeof source.lastMessage === "string" ? source.lastMessage : "",
    lastRunToken: asNullableString(source.lastRunToken),
  };
}

export async function readDataAutoUpdateSettings(db: D1Database) {
  const row = await db
    .prepare("SELECT value FROM app_metadata WHERE key = ?")
    .bind(DATA_AUTO_UPDATE_SETTINGS_KEY)
    .first<{ value: string }>();
  if (!row?.value) return { ...DEFAULT_DATA_AUTO_UPDATE_SETTINGS };
  try {
    return normalizeDataAutoUpdateSettings(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_DATA_AUTO_UPDATE_SETTINGS };
  }
}

export async function writeDataAutoUpdateSettings(
  db: D1Database,
  patch: Partial<DataAutoUpdateSettings>,
) {
  const current = await readDataAutoUpdateSettings(db);
  const next = normalizeDataAutoUpdateSettings({ ...current, ...patch });
  await db
    .prepare(`INSERT INTO app_metadata (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(DATA_AUTO_UPDATE_SETTINGS_KEY, JSON.stringify(next))
    .run();
  return next;
}
