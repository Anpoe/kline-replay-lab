export type DataAutoUpdateStatus = "idle" | "running" | "completed" | "partial" | "failed";

export type DataAutoUpdateSettings = {
  enabled: boolean;
  scheduledEnabled: boolean;
  scheduledTime: string;
  lastCheckDate: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: DataAutoUpdateStatus;
  lastMessage: string;
  lastRunToken: string | null;
};

export const DATA_AUTO_UPDATE_SETTINGS_KEY = "data_auto_update_settings_v1";
export const DEFAULT_DATA_AUTO_UPDATE_SCHEDULE_TIME = "18:00";

export const DEFAULT_DATA_AUTO_UPDATE_SETTINGS: DataAutoUpdateSettings = {
  enabled: false,
  scheduledEnabled: false,
  scheduledTime: DEFAULT_DATA_AUTO_UPDATE_SCHEDULE_TIME,
  lastCheckDate: null,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastStatus: "idle",
  lastMessage: "",
  lastRunToken: null,
};

const DATA_AUTO_UPDATE_LEASE_MS = 10 * 60 * 1000;

function asNullableString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

export function isValidDataAutoUpdateScheduleTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function localMinutesInTimeZone(now: Date, timeZone?: string) {
  if (!timeZone) return now.getHours() * 60 + now.getMinutes();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

export function isScheduledDataAutoUpdateDue(
  settings: Pick<DataAutoUpdateSettings, "scheduledEnabled" | "scheduledTime">,
  now = new Date(),
  timeZone?: string,
) {
  if (settings.scheduledEnabled !== true || !isValidDataAutoUpdateScheduleTime(settings.scheduledTime)) {
    return false;
  }
  const [hours, minutes] = settings.scheduledTime.split(":").map(Number);
  return localMinutesInTimeZone(now, timeZone) >= hours * 60 + minutes;
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
    scheduledEnabled: source.scheduledEnabled === true,
    scheduledTime: isValidDataAutoUpdateScheduleTime(source.scheduledTime)
      ? source.scheduledTime
      : DEFAULT_DATA_AUTO_UPDATE_SCHEDULE_TIME,
    lastCheckDate: asNullableString(source.lastCheckDate),
    lastStartedAt: asNullableString(source.lastStartedAt),
    lastFinishedAt: asNullableString(source.lastFinishedAt),
    lastStatus: asStatus(source.lastStatus),
    lastMessage: typeof source.lastMessage === "string" ? source.lastMessage : "",
    lastRunToken: asNullableString(source.lastRunToken),
  };
}

export function shouldClaimDataAutoUpdate(
  settings: DataAutoUpdateSettings,
  date: string,
  nowMs = Date.now(),
  trigger: "startup" | "scheduled" = "startup",
) {
  if (!settings.enabled && !settings.scheduledEnabled) return false;
  const now = new Date(nowMs);
  if (trigger === "scheduled" && !isScheduledDataAutoUpdateDue(settings, now)) return false;
  if (!settings.enabled && !isScheduledDataAutoUpdateDue(settings, now)) return false;
  if (settings.lastStatus === "running") {
    const startedAt = settings.lastStartedAt ? Date.parse(settings.lastStartedAt) : Number.NaN;
    return Number.isFinite(startedAt) && nowMs - startedAt > DATA_AUTO_UPDATE_LEASE_MS;
  }
  if (settings.lastCheckDate === date) return false;
  return true;
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

function asIsoString(value: Date | undefined) {
  return (value ?? new Date()).toISOString();
}

async function readRawDataAutoUpdateSettings(db: D1Database) {
  return await db
    .prepare("SELECT value FROM app_metadata WHERE key = ?")
    .bind(DATA_AUTO_UPDATE_SETTINGS_KEY)
    .first<{ value: string }>();
}

function parseDataAutoUpdateSettings(value: string | undefined) {
  if (!value) return { ...DEFAULT_DATA_AUTO_UPDATE_SETTINGS };
  try {
    return normalizeDataAutoUpdateSettings(JSON.parse(value));
  } catch {
    return { ...DEFAULT_DATA_AUTO_UPDATE_SETTINGS };
  }
}

export async function claimDataAutoUpdate(
  db: D1Database,
  input: { date: string; runToken: string; now?: Date; trigger?: "startup" | "scheduled" },
) {
  const row = await readRawDataAutoUpdateSettings(db);
  const current = parseDataAutoUpdateSettings(row?.value);
  const now = input.now ?? new Date();
  if (!shouldClaimDataAutoUpdate(current, input.date, now.getTime(), input.trigger ?? "startup")) {
    return { claimed: false, settings: current };
  }

  const next = normalizeDataAutoUpdateSettings({
    ...current,
    lastCheckDate: input.date,
    lastStartedAt: asIsoString(now),
    lastFinishedAt: null,
    lastStatus: "running",
    lastMessage: "正在检查已有市场的最新数据…",
    lastRunToken: input.runToken,
  });
  const result = await db.prepare(`INSERT INTO app_metadata (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
    WHERE app_metadata.value = ?`)
    .bind(DATA_AUTO_UPDATE_SETTINGS_KEY, JSON.stringify(next), row?.value ?? null)
    .run();
  if (Number(result.meta?.changes ?? 0) > 0) return { claimed: true, settings: next };
  return { claimed: false, settings: await readDataAutoUpdateSettings(db) };
}

export async function completeDataAutoUpdate(
  db: D1Database,
  input: {
    runToken?: string;
    status: Exclude<DataAutoUpdateStatus, "idle" | "running">;
    message: string;
    now?: Date;
  },
) {
  const row = await readRawDataAutoUpdateSettings(db);
  const current = parseDataAutoUpdateSettings(row?.value);
  if (current.lastStatus !== "running"
    || (input.runToken && current.lastRunToken !== input.runToken)) {
    return { completed: false, settings: current };
  }

  const next = normalizeDataAutoUpdateSettings({
    ...current,
    lastStatus: input.status,
    lastMessage: input.message,
    lastFinishedAt: asIsoString(input.now),
    lastRunToken: null,
  });
  const result = await db.prepare(
    "UPDATE app_metadata SET value = ? WHERE key = ? AND value = ?",
  ).bind(JSON.stringify(next), DATA_AUTO_UPDATE_SETTINGS_KEY, row?.value ?? null).run();
  if (Number(result.meta?.changes ?? 0) > 0) return { completed: true, settings: next };
  return { completed: false, settings: await readDataAutoUpdateSettings(db) };
}

export async function renewDataAutoUpdate(
  db: D1Database,
  input: { runToken: string; now?: Date },
) {
  const row = await readRawDataAutoUpdateSettings(db);
  const current = parseDataAutoUpdateSettings(row?.value);
  if (current.lastStatus !== "running" || !input.runToken || current.lastRunToken !== input.runToken) {
    return { renewed: false, settings: current };
  }

  const next = normalizeDataAutoUpdateSettings({
    ...current,
    lastStartedAt: asIsoString(input.now),
  });
  const result = await db.prepare(
    "UPDATE app_metadata SET value = ? WHERE key = ? AND value = ?",
  ).bind(JSON.stringify(next), DATA_AUTO_UPDATE_SETTINGS_KEY, row?.value ?? null).run();
  if (Number(result.meta?.changes ?? 0) > 0) return { renewed: true, settings: next };
  return { renewed: false, settings: await readDataAutoUpdateSettings(db) };
}

export async function writeDataAutoUpdateSettings(
  db: D1Database,
  patch: Partial<DataAutoUpdateSettings>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await readRawDataAutoUpdateSettings(db);
    const current = parseDataAutoUpdateSettings(row?.value);
    const next = normalizeDataAutoUpdateSettings({ ...current, ...patch });
    const result = await db.prepare(`INSERT INTO app_metadata (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
      WHERE app_metadata.value = ?`)
      .bind(DATA_AUTO_UPDATE_SETTINGS_KEY, JSON.stringify(next), row?.value ?? null)
      .run();
    if (Number(result.meta?.changes ?? 0) > 0) return next;
  }
  return await readDataAutoUpdateSettings(db);
}
