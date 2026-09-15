import { ensureSchema, getRawDb } from "../../../db/runtime";
import {
  claimDataAutoUpdate,
  completeDataAutoUpdate,
  readDataAutoUpdateSettings,
  renewDataAutoUpdate,
  writeDataAutoUpdateSettings,
  isValidDataAutoUpdateScheduleTime,
  type DataAutoUpdateStatus,
} from "../../lib/dataAutoUpdateSettings";
import { inspectExistingMarkets } from "../../lib/dataAutoUpdateService";

function publicSettings(settings: Awaited<ReturnType<typeof readDataAutoUpdateSettings>>) {
  const { lastRunToken, ...safe } = settings;
  void lastRunToken;
  return safe;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validStatus(value: unknown): value is Exclude<DataAutoUpdateStatus, "idle" | "running"> {
  return value === "completed" || value === "partial" || value === "failed" || value === "deferred";
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
  const body = await request.json().catch(() => ({})) as {
    enabled?: unknown;
    scheduledEnabled?: unknown;
    scheduledTime?: unknown;
  };
  const patch: {
    enabled?: boolean;
    scheduledEnabled?: boolean;
    scheduledTime?: string;
  } = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return Response.json({ error: "自动更新开关参数不正确" }, { status: 400 });
    }
    patch.enabled = body.enabled;
  }
  if (body.scheduledEnabled !== undefined) {
    if (typeof body.scheduledEnabled !== "boolean") {
      return Response.json({ error: "定时自动更新开关参数不正确" }, { status: 400 });
    }
    patch.scheduledEnabled = body.scheduledEnabled;
  }
  if (body.scheduledTime !== undefined) {
    if (!isValidDataAutoUpdateScheduleTime(body.scheduledTime)) {
      return Response.json({ error: "定时检查时间格式不正确" }, { status: 400 });
    }
    patch.scheduledTime = body.scheduledTime;
  }
  if (!Object.keys(patch).length) {
    return Response.json({ error: "缺少自动更新设置" }, { status: 400 });
  }
  const settings = await writeDataAutoUpdateSettings(getRawDb(), patch);
  return Response.json({ settings: publicSettings(settings) });
}

export async function POST(request: Request) {
  await ensureSchema();
  const body = await request.json().catch(() => ({})) as {
    action?: "claim" | "complete" | "renew";
    date?: unknown;
    runToken?: unknown;
    trigger?: unknown;
    status?: unknown;
    message?: unknown;
  };
  const db = getRawDb();
  if (body.action === "claim") {
    if (!validDate(body.date)) return Response.json({ error: "缺少有效的本地日期" }, { status: 400 });
    const runToken = typeof body.runToken === "string" && body.runToken.trim()
      ? body.runToken.trim()
      : crypto.randomUUID();
    if (body.trigger !== undefined && body.trigger !== "startup" && body.trigger !== "scheduled") {
      return Response.json({ error: "自动更新触发来源不正确" }, { status: 400 });
    }
    const result = await claimDataAutoUpdate(db, {
      date: body.date,
      runToken,
      trigger: body.trigger === "scheduled" ? "scheduled" : "startup",
    });
    return Response.json({
      shouldRun: result.claimed,
      settings: publicSettings(result.settings),
    });
  }
  if (body.action === "complete") {
    if (!validStatus(body.status)) return Response.json({ error: "自动更新完成状态不正确" }, { status: 400 });
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 800) : "";
    const runToken = typeof body.runToken === "string" ? body.runToken.trim() : "";
    const result = await completeDataAutoUpdate(db, {
      runToken,
      status: body.status,
      message,
    });
    return Response.json({ completed: result.completed, settings: publicSettings(result.settings) });
  }
  if (body.action === "renew") {
    const runToken = typeof body.runToken === "string" ? body.runToken.trim() : "";
    const result = await renewDataAutoUpdate(db, { runToken });
    return Response.json({ renewed: result.renewed, settings: publicSettings(result.settings) });
  }
  return Response.json({ error: "不支持的自动更新操作" }, { status: 400 });
}
