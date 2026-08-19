import { ensureSchema, getRawDb } from "../../../db/runtime";
import {
  readDataAutoUpdateSettings,
  writeDataAutoUpdateSettings,
  type DataAutoUpdateStatus,
} from "../../lib/dataAutoUpdateSettings";
import { inspectExistingMarkets } from "../../lib/dataAutoUpdateService";

function publicSettings(settings: Awaited<ReturnType<typeof readDataAutoUpdateSettings>>) {
  const safe = { ...settings };
  delete safe.lastRunToken;
  return safe;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validStatus(value: unknown): value is Exclude<DataAutoUpdateStatus, "idle" | "running"> {
  return value === "completed" || value === "partial" || value === "failed";
}

export async function GET(request: Request) {
  await ensureSchema();
  const url = new URL(request.url);
  if (url.searchParams.get("scope") === "existing") {
    try {
      return Response.json(await inspectExistingMarkets(getRawDb()), {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "市场最新状态检查失败" }, { status: 502 });
    }
  }
  return Response.json({ settings: publicSettings(await readDataAutoUpdateSettings(getRawDb())) }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const body = await request.json().catch(() => ({})) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return Response.json({ error: "自动更新开关参数不正确" }, { status: 400 });
  }
  const settings = await writeDataAutoUpdateSettings(getRawDb(), { enabled: body.enabled });
  return Response.json({ settings: publicSettings(settings) });
}

export async function POST(request: Request) {
  await ensureSchema();
  const body = await request.json().catch(() => ({})) as {
    action?: "claim" | "complete";
    date?: unknown;
    runToken?: unknown;
    status?: unknown;
    message?: unknown;
  };
  const db = getRawDb();
  const current = await readDataAutoUpdateSettings(db);
  if (body.action === "claim") {
    if (!validDate(body.date)) return Response.json({ error: "缺少有效的本地日期" }, { status: 400 });
    if (!current.enabled) {
      return Response.json({ shouldRun: false, settings: publicSettings(current) });
    }
    const runToken = typeof body.runToken === "string" && body.runToken.trim()
      ? body.runToken.trim()
      : crypto.randomUUID();
    const sameDate = current.lastCheckDate === body.date;
    const startedAt = current.lastStartedAt ? Date.parse(current.lastStartedAt) : Number.NaN;
    const staleRunning = current.lastStatus === "running"
      && Number.isFinite(startedAt)
      && Date.now() - startedAt > 10 * 60 * 1000;
    if (sameDate && current.lastStatus === "completed") {
      return Response.json({ shouldRun: false, settings: publicSettings(current) });
    }
    if (sameDate && current.lastStatus === "running" && !staleRunning) {
      return Response.json({ shouldRun: false, settings: publicSettings(current) });
    }
    if (sameDate && current.lastStatus !== "running") {
      return Response.json({ shouldRun: false, settings: publicSettings(current) });
    }
    const settings = await writeDataAutoUpdateSettings(db, {
      lastCheckDate: body.date,
      lastStartedAt: new Date().toISOString(),
      lastFinishedAt: null,
      lastStatus: "running",
      lastMessage: "正在检查已有市场的最新数据…",
      lastRunToken: runToken,
    });
    return Response.json({ shouldRun: true, settings: publicSettings(settings) });
  }
  if (body.action === "complete") {
    if (!validStatus(body.status)) return Response.json({ error: "自动更新完成状态不正确" }, { status: 400 });
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 800) : "";
    const settings = await writeDataAutoUpdateSettings(db, {
      lastStatus: body.status,
      lastMessage: message,
      lastFinishedAt: new Date().toISOString(),
      lastRunToken: null,
    });
    return Response.json({ settings: publicSettings(settings) });
  }
  return Response.json({ error: "不支持的自动更新操作" }, { status: 400 });
}
