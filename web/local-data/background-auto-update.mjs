import { randomUUID as defaultRandomUUID } from "node:crypto";

const DEFAULT_WEB_ORIGIN = "http://127.0.0.1:3101";
const CN_POLL_LIMIT = 900;
const US_POLL_LIMIT = 2_000;
const FX_POLL_LIMIT = 2_000;
const DEFAULT_LEASE_RENEW_INTERVAL_MS = 2 * 60 * 1000;

const jsonHeaders = {
  accept: "application/json",
  "content-type": "application/json",
};

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error, fallback = "后台自动更新失败") {
  return error instanceof Error && error.message ? error.message : fallback;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function localDateInTimeZone(now = new Date(), timeZone) {
  if (!timeZone) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localMinutesInTimeZone(now, timeZone) {
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

export function isScheduledAutoUpdateDue(settings, now = new Date(), timeZone) {
  if (settings?.scheduledEnabled !== true) return false;
  const scheduledTime = typeof settings.scheduledTime === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(settings.scheduledTime)
    ? settings.scheduledTime
    : null;
  if (!scheduledTime) return false;
  const [hours, minutes] = scheduledTime.split(":").map(Number);
  return localMinutesInTimeZone(now, timeZone) >= hours * 60 + minutes;
}

function publicState(state, activeRun) {
  return {
    ...state,
    running: Boolean(activeRun),
  };
}

export function createBackgroundAutoUpdateRunner({
  origin = process.env.KLINE_WEB_ORIGIN ?? DEFAULT_WEB_ORIGIN,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  timeZone,
  sleep = defaultSleep,
  randomUUID = defaultRandomUUID,
  leaseRenewIntervalMs = DEFAULT_LEASE_RENEW_INTERVAL_MS,
  onLog = () => undefined,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("后台更新需要可用的 fetch 实现");

  const state = {
    phase: "idle",
    market: null,
    taskId: null,
    message: "",
    autoUpdateEnabled: false,
    autoUpdateScheduledEnabled: false,
    autoUpdateScheduleTime: null,
    localDate: null,
    lastStatus: "idle",
    lastStartedAt: null,
    lastFinishedAt: null,
    lastMessage: "",
    error: null,
    updatedAt: new Date(0).toISOString(),
  };
  let stopped = false;
  let activeRun = null;
  let leaseTimer = null;
  let leaseRenewal = null;
  let leaseLostError = null;

  function snapshot() {
    return publicState({ ...state }, activeRun);
  }

  function updateState(patch) {
    Object.assign(state, patch, { updatedAt: now().toISOString() });
    return snapshot();
  }

  function log(level, message, details = {}) {
    const entry = {
      timestamp: now().toISOString(),
      level,
      message,
      ...details,
    };
    onLog(entry);
    return entry;
  }

  async function readResponse(response, fallback) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = typeof payload?.error === "string" && payload.error.trim()
        ? payload.error.trim()
        : fallback;
      throw new Error(error);
    }
    return payload;
  }

  async function requestJson(path, init = {}) {
    const response = await fetchImpl(`${origin}${path}`, {
      ...init,
      headers: { ...jsonHeaders, ...(init.headers ?? {}) },
    });
    return await readResponse(response, `请求 ${path} 失败`);
  }

  function assertLease() {
    if (leaseLostError) throw leaseLostError;
  }

  async function renewLease(token) {
    if (leaseLostError) return false;
    if (leaseRenewal) return await leaseRenewal;
    leaseRenewal = (async () => {
      try {
        const payload = await requestJson("/api/data-auto-update", {
          method: "POST",
          body: JSON.stringify({ action: "renew", runToken: token }),
        });
        if (payload?.renewed === true) return true;
        leaseLostError = new Error("自动更新运行权已失效，已停止继续写入结果");
        log("error", leaseLostError.message);
        return false;
      } catch (error) {
        log("warn", `自动更新运行权续租失败：${errorMessage(error)}`);
        return false;
      } finally {
        leaseRenewal = null;
      }
    })();
    return await leaseRenewal;
  }

  function startLeaseHeartbeat(token) {
    if (!Number.isFinite(leaseRenewIntervalMs) || leaseRenewIntervalMs <= 0) return;
    leaseLostError = null;
    leaseTimer = setInterval(() => void renewLease(token), leaseRenewIntervalMs);
    leaseTimer.unref?.();
  }

  function stopLeaseHeartbeat() {
    if (leaseTimer) {
      clearInterval(leaseTimer);
      leaseTimer = null;
    }
    leaseRenewal = null;
    leaseLostError = null;
  }

  async function waitFor(read, isDone, {
    attempts,
    intervalMs,
    timeoutMessage,
  }) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      assertLease();
      const value = await read();
      if (isDone(value)) return value;
      await sleep(intervalMs);
    }
    throw new Error(timeoutMessage);
  }

  function setMarket(market, message, taskId = null) {
    updateState({
      phase: "running",
      market,
      taskId,
      message,
      error: null,
    });
    log("info", message, { market, taskId });
  }

  async function startCnUpdate() {
    try {
      await requestJson("/api/cn-maintenance", {
        method: "POST",
        body: JSON.stringify({ action: "start", mode: "incremental" }),
      });
    } catch (error) {
      if (!/正在运行/.test(errorMessage(error))) throw error;
    }
    const payload = await waitFor(
      () => requestJson("/api/cn-maintenance"),
      (payload) => {
        const task = payload?.maintenanceTask;
        if (!task || task.status === "completed") return true;
        if (task.status === "failed" || task.status === "paused") {
          throw new Error(task.error ?? task.message ?? "A 股自动更新未完成");
        }
        return false;
      },
      {
        attempts: CN_POLL_LIMIT,
        intervalMs: 900,
        timeoutMessage: "A 股自动更新等待超时，请到数据页查看任务状态",
      },
    );
    return {
      deferred: payload?.maintenanceTask?.deferred === true,
      task: payload?.maintenanceTask ?? null,
    };
  }

  async function runUsUpdate() {
    const started = await requestJson("/api/data-jobs/market/sync", {
      method: "POST",
      body: JSON.stringify({ market: "US", mode: "update" }),
    });
    const run = started?.run;
    if (!run) throw new Error("美股自动更新没有创建任务");
    if (run.status === "completed") return;
    if (["completed_with_errors", "cancelled", "paused"].includes(run.status)) {
      throw new Error(`美股自动更新状态为 ${run.status}`);
    }

    for (let attempt = 0; attempt < US_POLL_LIMIT; attempt += 1) {
      assertLease();
      const payload = await requestJson("/api/data-jobs/market/sync/worker", {
        method: "POST",
        body: JSON.stringify({ runId: run.id }),
      });
      const next = payload?.run;
      if (!next) {
        if (attempt >= 4) throw new Error(payload?.error ?? "美股自动更新批次执行失败");
        await sleep(1_500);
        continue;
      }
      if (next.status === "completed") return;
      if (["completed_with_errors", "cancelled", "paused"].includes(next.status)) {
        throw new Error(`美股自动更新状态为 ${next.status}`);
      }
      await sleep(250);
    }
    throw new Error("美股自动更新等待超时，请到数据页查看任务状态");
  }

  async function getOrCreateFxTask(pairId, marketLabel = "外汇") {
    const current = await requestJson(`/api/fx-data?pairId=${encodeURIComponent(pairId)}`);
    const task = current?.task;
    if (task && ["queued", "running"].includes(task.status)) return task;
    if (task?.status === "paused") {
      const resumed = await requestJson("/api/fx-data/task", {
        method: "PATCH",
        body: JSON.stringify({ taskId: task.id, action: "resume" }),
      });
      if (resumed?.task) return resumed.task;
    }
    const created = await requestJson("/api/fx-data/update", {
      method: "POST",
      body: JSON.stringify({ pairId }),
    });
    if (!created?.task) throw new Error(`${pairId} ${marketLabel}自动更新任务创建失败`);
    return created.task;
  }

  async function runFxTask(task) {
    if (["completed", "cancelled"].includes(task.status)) {
      if (task.status === "cancelled") throw new Error(`${task.id} 外汇自动更新已取消`);
      return;
    }
    for (let attempt = 0; attempt < FX_POLL_LIMIT; attempt += 1) {
      assertLease();
      const payload = await requestJson("/api/fx-data/run", {
        method: "POST",
        body: JSON.stringify({ taskId: task.id }),
      });
      const next = payload?.task;
      if (next?.status === "completed") return;
      if (next?.status === "cancelled" || next?.status === "failed" || !next) {
        throw new Error(payload?.error ?? next?.error ?? `${task.id} 外汇自动更新失败`);
      }
      await sleep(300);
    }
    throw new Error(`${task.id} 外汇自动更新等待超时，请到数据页查看任务状态`);
  }

  async function complete(token, status, message) {
    return await requestJson("/api/data-auto-update", {
      method: "POST",
      body: JSON.stringify({
        action: "complete",
        status,
        message: message.slice(0, 800),
        runToken: token,
      }),
    });
  }

  async function runIfDueInternal() {
    updateState({ phase: "checking", market: null, taskId: null, error: null });
    const settingsPayload = await requestJson("/api/data-auto-update");
    const settings = asObject(settingsPayload.settings);
    state.autoUpdateEnabled = settings.enabled === true;
    state.autoUpdateScheduledEnabled = settings.scheduledEnabled === true;
    state.autoUpdateScheduleTime = typeof settings.scheduledTime === "string" ? settings.scheduledTime : null;
    state.lastStatus = settings.lastStatus ?? "idle";
    state.lastStartedAt = settings.lastStartedAt ?? null;
    state.lastFinishedAt = settings.lastFinishedAt ?? null;
    state.lastMessage = settings.lastMessage ?? "";
    const scheduledDue = isScheduledAutoUpdateDue(settings, now(), timeZone);
    if (!state.autoUpdateEnabled && !scheduledDue) {
      const localDate = localDateInTimeZone(now(), timeZone);
      if (state.autoUpdateScheduledEnabled && state.autoUpdateScheduleTime) {
        updateState({
          phase: "idle",
          message: `今日定时检查将在 ${state.autoUpdateScheduleTime}（系统时间）执行`,
          localDate,
        });
        log("info", "尚未到每日定时自动更新时间", { localDate, scheduledTime: state.autoUpdateScheduleTime });
        return { claimed: false, reason: "scheduled-not-due" };
      }
      updateState({ phase: "idle", message: "每日自动更新未开启", localDate: null });
      log("info", "每日自动更新未开启");
      return { claimed: false, reason: "disabled" };
    }

    const localDate = localDateInTimeZone(now(), timeZone);
    updateState({ localDate, message: `正在申请 ${localDate} 的自动更新任务` });
    const runToken = randomUUID();
    const claim = await requestJson("/api/data-auto-update", {
      method: "POST",
      body: JSON.stringify({
        action: "claim",
        date: localDate,
        runToken,
        trigger: state.autoUpdateEnabled ? "startup" : "scheduled",
      }),
    });
    if (!claim?.shouldRun) {
      updateState({
        phase: "idle",
        message: claim?.settings?.lastMessage ?? "今天已完成自动检查",
        lastStatus: claim?.settings?.lastStatus ?? state.lastStatus,
        lastFinishedAt: claim?.settings?.lastFinishedAt ?? state.lastFinishedAt,
        lastMessage: claim?.settings?.lastMessage ?? state.lastMessage,
      });
      log("info", "今天已完成自动检查");
      return { claimed: false, reason: "already-checked" };
    }

    const token = runToken;
    const updated = [];
    const skipped = [];
    const deferredMarkets = [];
    const failures = [];
    startLeaseHeartbeat(token);
    updateState({
      phase: "running",
      lastStartedAt: now().toISOString(),
      message: "正在检查已有市场的最新数据…",
      lastStatus: "running",
    });
    log("info", "已取得当天自动更新任务运行权", { date: localDate });

    try {
      assertLease();
      const check = await requestJson("/api/data-auto-update?scope=existing");
      const markets = asObject(check.markets);
      const cn = asObject(markets.CN);
      const us = asObject(markets.US);
      const fx = asObject(markets.FX);
      const gold = asObject(markets.GOLD);

      if (cn.needsUpdate) {
        try {
          setMarket("CN", "正在执行 A 股每日增量");
          const cnUpdate = await startCnUpdate();
          if (cnUpdate.deferred) deferredMarkets.push("A股（尚未收市，等待收盘后重试）");
          else updated.push("A股");
        } catch (error) {
          const message = `A股：${errorMessage(error)}`;
          failures.push(message);
          log("error", message, { market: "CN" });
        }
      } else if (cn.existing) {
        skipped.push(`A股（${cn.reason ?? "无需更新"}）`);
      }

      if (us.needsUpdate) {
        try {
          setMarket("US", "正在执行美股同步");
          await runUsUpdate();
          updated.push("美股");
        } catch (error) {
          const message = `美股：${errorMessage(error)}`;
          failures.push(message);
          log("error", message, { market: "US" });
        }
      } else if (us.existing) {
        skipped.push(`美股（${us.reason ?? "无需更新"}）`);
      }

      const duePairIds = Array.isArray(fx.duePairIds) ? fx.duePairIds : [];
      for (const pairId of duePairIds) {
        try {
          setMarket("FX", `正在更新外汇 ${pairId}`);
          const task = await getOrCreateFxTask(pairId);
          updateState({ taskId: task.id, message: `正在更新外汇 ${pairId}` });
          await runFxTask(task);
          updated.push(pairId);
        } catch (error) {
          const message = `${pairId}：${errorMessage(error)}`;
          failures.push(message);
          log("error", message, { market: "FX", pairId });
        }
      }
      if (!duePairIds.length && fx.existing) skipped.push(`外汇（${fx.reason ?? "无需更新"}）`);
      const dueGoldPairIds = Array.isArray(gold.duePairIds) ? gold.duePairIds : [];
      for (const pairId of dueGoldPairIds) {
        try {
          setMarket("GOLD", `正在更新黄金 ${pairId}`);
          const task = await getOrCreateFxTask(pairId, "黄金");
          updateState({ taskId: task.id, message: `正在更新黄金 ${pairId}` });
          await runFxTask(task);
          updated.push(pairId);
        } catch (error) {
          const message = `${pairId}：${errorMessage(error)}`;
          failures.push(message);
          log("error", message, { market: "GOLD", pairId });
        }
      }
      if (!dueGoldPairIds.length && gold.existing) skipped.push(`黄金（${gold.reason ?? "无需更新"}）`);
      if (!cn.existing && !us.existing && !fx.existing && !gold.existing) skipped.push("没有发现已有历史数据的市场");

      const status = failures.length
        ? (updated.length ? "partial" : "failed")
        : deferredMarkets.length
          ? (updated.length ? "partial" : "deferred")
          : "completed";
      const message = [
        updated.length ? `已更新：${updated.join("、")}` : "没有需要拉取的新数据",
        skipped.length ? `已跳过：${skipped.join("；")}` : "",
        deferredMarkets.length ? `待收盘重试：${deferredMarkets.join("；")}` : "",
        failures.length ? `失败：${failures.join("；")}` : "",
      ].filter(Boolean).join("。 ");
      await complete(token, status, message);
      updateState({
        phase: status,
        market: null,
        taskId: null,
        message,
        lastStatus: status,
        lastFinishedAt: now().toISOString(),
        lastMessage: message,
        error: failures.length ? failures.join("；") : null,
      });
      log(status === "completed" ? "info" : "warn", message);
      return { claimed: true, status, updated, skipped, failures };
    } catch (error) {
      const message = errorMessage(error, "自动更新检查失败");
      failures.push(message);
      try {
        await complete(token, "failed", message);
      } catch (completeError) {
        log("error", `自动更新结果写入失败：${errorMessage(completeError)}`);
      }
      updateState({
        phase: "failed",
        market: null,
        taskId: null,
        message,
        lastStatus: "failed",
        lastFinishedAt: now().toISOString(),
        lastMessage: message,
        error: message,
      });
      log("error", message);
      return { claimed: true, status: "failed", updated, skipped, failures };
    } finally {
      stopLeaseHeartbeat();
    }
  }

  function runIfDue() {
    if (stopped) return Promise.resolve({ claimed: false, reason: "stopped" });
    if (activeRun) return activeRun;
    activeRun = runIfDueInternal().catch((error) => {
      const message = errorMessage(error);
      updateState({ phase: "waiting", message, error: message });
      log("error", message);
      return { claimed: false, reason: "unavailable", error: message };
    }).finally(() => {
      activeRun = null;
    });
    return activeRun;
  }

  function stop() {
    stopped = true;
    updateState({ phase: "stopped", message: "后台 worker 已停止调度" });
  }

  return {
    getState: snapshot,
    runIfDue,
    stop,
  };
}
