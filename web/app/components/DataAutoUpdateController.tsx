"use client";

import { useEffect } from "react";

type AutoUpdateSettings = {
  enabled: boolean;
  lastCheckDate: string | null;
  lastStatus: "idle" | "running" | "completed" | "partial" | "failed";
};

type FxPairCheck = {
  pairId: string;
  needsUpdate: boolean;
  error?: string;
};

type ExistingMarketsResponse = {
  markets: {
    CN: { existing: boolean; needsUpdate: boolean; reason: string };
    US: { existing: boolean; needsUpdate: boolean; reason: string };
    FX: { existing: boolean; needsUpdate: boolean; duePairIds: string[]; pairs: FxPairCheck[]; reason: string };
    GOLD: { existing: boolean; needsUpdate: boolean; reason: string };
  };
};

type MaintenanceTask = {
  status?: string;
  message?: string;
  error?: string | null;
};

type MarketSyncRun = {
  id: string;
  status: string;
};

type FxTask = {
  id: string;
  status: string;
  message?: string | null;
  error?: string | null;
};

let startupAutoUpdateStarted = false;

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function localDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function readJson<T>(response: Response) {
  return await response.json().catch(() => ({})) as T;
}

async function waitForCnMaintenance() {
  for (let attempt = 0; attempt < 900; attempt += 1) {
    const response = await fetch("/api/cn-maintenance", { cache: "no-store" });
    const payload = await readJson<{ maintenanceTask?: MaintenanceTask | null; error?: string }>(response);
    if (!response.ok) throw new Error(payload.error ?? "无法读取 A 股自动更新进度");
    const task = payload.maintenanceTask;
    if (!task || task.status === "completed") return;
    if (task.status === "failed" || task.status === "paused") {
      throw new Error(task.error ?? task.message ?? "A 股自动更新未完成");
    }
    await sleep(900);
  }
  throw new Error("A 股自动更新等待超时，请到数据页查看任务状态");
}

async function startCnUpdate() {
  const response = await fetch("/api/cn-maintenance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "start", mode: "incremental" }),
  });
  const payload = await readJson<{ maintenanceTask?: MaintenanceTask | null; error?: string }>(response);
  if (!response.ok && !/正在运行/.test(payload.error ?? "")) {
    throw new Error(payload.error ?? "A 股自动更新启动失败");
  }
  await waitForCnMaintenance();
}

async function runUsUpdate() {
  const start = await fetch("/api/data-jobs/market/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ market: "US", mode: "update" }),
  });
  const started = await readJson<{ run?: MarketSyncRun; error?: string }>(start);
  if (!start.ok || !started.run) throw new Error(started.error ?? "美股自动更新启动失败");
  if (["completed", "completed_with_errors", "cancelled", "paused"].includes(started.run.status)) {
    if (started.run.status === "completed_with_errors") throw new Error("美股自动更新有失败品种，请到数据页查看详情");
    return;
  }
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    let response: Response;
    try {
      response = await fetch("/api/data-jobs/market/sync/worker", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: started.run.id }),
      });
    } catch (error) {
      if (attempt >= 4) throw error;
      await sleep(1_500);
      continue;
    }
    const payload = await readJson<{ run?: MarketSyncRun; error?: string }>(response);
    if (!response.ok || !payload.run) {
      if (attempt >= 4) throw new Error(payload.error ?? "美股自动更新批次执行失败");
      await sleep(1_500);
      continue;
    }
    if (["completed", "completed_with_errors", "cancelled", "paused"].includes(payload.run.status)) {
      if (payload.run.status === "completed_with_errors") throw new Error("美股自动更新有失败品种，请到数据页查看详情");
      return;
    }
    await sleep(250);
  }
  throw new Error("美股自动更新等待超时，请到数据页查看任务状态");
}

async function getOrCreateFxTask(pairId: string) {
  const currentResponse = await fetch(`/api/fx-data?pairId=${encodeURIComponent(pairId)}`, { cache: "no-store" });
  const current = await readJson<{ task?: FxTask | null }>(currentResponse);
  if (currentResponse.ok && current.task && ["queued", "running"].includes(current.task.status)) return current.task;
  if (currentResponse.ok && current.task?.status === "paused") {
    const resumedResponse = await fetch("/api/fx-data/task", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: current.task.id, action: "resume" }),
    });
    const resumed = await readJson<{ task?: FxTask | null; error?: string }>(resumedResponse);
    if (resumedResponse.ok && resumed.task) return resumed.task;
  }
  const response = await fetch("/api/fx-data/update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairId }),
  });
  const payload = await readJson<{ task?: FxTask | null; error?: string }>(response);
  if (!response.ok || !payload.task) throw new Error(payload.error ?? `${pairId} 外汇自动更新任务创建失败`);
  return payload.task;
}

async function runFxTask(task: FxTask) {
  if (["completed", "cancelled"].includes(task.status)) return;
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const response = await fetch("/api/fx-data/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    });
    const payload = await readJson<{ task?: FxTask | null; error?: string }>(response);
    if (payload.task && ["completed", "cancelled"].includes(payload.task.status)) return;
    if (payload.task?.status === "failed" || !response.ok) {
      throw new Error(payload.error ?? payload.task?.error ?? `${task.id} 外汇自动更新失败`);
    }
    await sleep(300);
  }
  throw new Error(`${task.id} 外汇自动更新等待超时，请到数据页查看任务状态`);
}

async function completeAutoUpdate(
  status: "completed" | "partial" | "failed",
  message: string,
) {
  await fetch("/api/data-auto-update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "complete", status, message }),
  }).catch(() => undefined);
  window.dispatchEvent(new Event("data-auto-update-updated"));
}

async function runStartupAutoUpdate() {
  const settingsResponse = await fetch("/api/data-auto-update", { cache: "no-store" });
  if (!settingsResponse.ok) return;
  const settingsPayload = await readJson<{ settings?: AutoUpdateSettings }>(settingsResponse);
  if (!settingsPayload.settings?.enabled) return;

  const claimResponse = await fetch("/api/data-auto-update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "claim", date: localDate(), runToken: crypto.randomUUID() }),
  });
  const claim = await readJson<{ shouldRun?: boolean }>(claimResponse);
  if (!claimResponse.ok || !claim.shouldRun) return;

  const updated: string[] = [];
  const skipped: string[] = [];
  const failures: string[] = [];
  try {
    const checkResponse = await fetch("/api/data-auto-update?scope=existing", { cache: "no-store" });
    const check = await readJson<ExistingMarketsResponse & { error?: string }>(checkResponse);
    if (!checkResponse.ok || !check.markets) throw new Error(check.error ?? "市场最新状态检查失败");

    const cn = check.markets.CN;
    if (cn.needsUpdate) {
      try {
        await startCnUpdate();
        updated.push("A股");
      } catch (error) {
        failures.push(error instanceof Error ? `A股：${error.message}` : "A股自动更新失败");
      }
    } else if (cn.existing) {
      skipped.push(`A股（${cn.reason}）`);
    }

    const us = check.markets.US;
    if (us.needsUpdate) {
      try {
        await runUsUpdate();
        updated.push("美股");
      } catch (error) {
        failures.push(error instanceof Error ? `美股：${error.message}` : "美股自动更新失败");
      }
    } else if (us.existing) {
      skipped.push(`美股（${us.reason}）`);
    }

    const fx = check.markets.FX;
    if (fx.duePairIds.length) {
      for (const pairId of fx.duePairIds) {
        try {
          await runFxTask(await getOrCreateFxTask(pairId));
          updated.push(pairId);
        } catch (error) {
          failures.push(error instanceof Error ? `${pairId}：${error.message}` : `${pairId} 外汇自动更新失败`);
        }
      }
    } else if (fx.existing) {
      skipped.push(`外汇（${fx.reason}）`);
    }

    if (!cn.existing && !us.existing && !fx.existing) {
      skipped.push("没有发现已有历史数据的市场");
    }
    const message = [
      updated.length ? `已更新：${updated.join("、")}` : "没有需要拉取的新数据",
      skipped.length ? `已跳过：${skipped.join("；")}` : "",
      failures.length ? `失败：${failures.join("；")}` : "",
    ].filter(Boolean).join("。 ");
    await completeAutoUpdate(failures.length ? (updated.length ? "partial" : "failed") : "completed", message);
  } catch (error) {
    await completeAutoUpdate("failed", error instanceof Error ? error.message : "自动更新检查失败");
  }
}

export function DataAutoUpdateController() {
  useEffect(() => {
    if (startupAutoUpdateStarted) return;
    startupAutoUpdateStarted = true;
    void runStartupAutoUpdate();
  }, []);
  return null;
}
