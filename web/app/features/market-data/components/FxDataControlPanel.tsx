"use client";

import {
  AlertCircle,
  Check,
  CloudDownload,
  Database,
  Pause,
  Play,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import { TIMEFRAME_IDS, timeframeLabel, type TimeframeId } from "../../../lib/timeframeCatalog.ts";

export type FxTimeframe = TimeframeId;

export type FxCurrencyPair = {
  id: string;
  label: string;
  dukascopySymbol?: string;
  twelveDataSymbol?: string;
  pricePrecision?: number;
};

export const DEFAULT_FX_CURRENCY_PAIRS = [
  { id: "EURUSD.FX", label: "EUR/USD", dukascopySymbol: "EURUSD", twelveDataSymbol: "EUR/USD", pricePrecision: 5 },
  { id: "GBPUSD.FX", label: "GBP/USD", dukascopySymbol: "GBPUSD", twelveDataSymbol: "GBP/USD", pricePrecision: 5 },
  { id: "USDJPY.FX", label: "USD/JPY", dukascopySymbol: "USDJPY", twelveDataSymbol: "USD/JPY", pricePrecision: 3 },
  { id: "AUDUSD.FX", label: "AUD/USD", dukascopySymbol: "AUDUSD", twelveDataSymbol: "AUD/USD", pricePrecision: 5 },
  { id: "USDCAD.FX", label: "USD/CAD", dukascopySymbol: "USDCAD", twelveDataSymbol: "USD/CAD", pricePrecision: 5 },
  { id: "USDCHF.FX", label: "USD/CHF", dukascopySymbol: "USDCHF", twelveDataSymbol: "USD/CHF", pricePrecision: 5 },
] as const satisfies readonly FxCurrencyPair[];

export const DEFAULT_GOLD_INSTRUMENTS = [
  { id: "XAUUSD.GOLD", label: "XAU/USD", dukascopySymbol: "XAUUSD", twelveDataSymbol: "XAU/USD", pricePrecision: 2 },
] as const satisfies readonly FxCurrencyPair[];

export type FxDataControlApiPaths = {
  initialize: string;
  update: string;
  task: string;
};

export type FxTaskMode = "initialize" | "update";
export type FxTaskStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type FxTaskStage = "queued" | "download" | "parse" | "aggregate" | "validate" | "persist" | "completed";
export type FxTaskAction = "pause" | "resume" | "retry" | "cancel";

export type FxQualitySummary = {
  acceptedRows?: number;
  insertedBars?: number;
  correctedBars?: number;
  invalidRows?: number;
  duplicateRows?: number;
  missingIntervals?: number;
  abnormalJumps?: number;
  earliestTimestamp?: string | null;
  latestTimestamp?: string | null;
  historyBoundary?: string | null;
  source?: string | null;
  checkedAt?: string | null;
};

export type FxDataTask = {
  id: string;
  mode: FxTaskMode;
  pairId: string;
  pairLabel?: string;
  status: FxTaskStatus;
  stage: FxTaskStage;
  stageProgress?: number;
  message?: string | null;
  error?: string | null;
  progress?: {
    completed?: number;
    total?: number;
    unit?: string;
    percent?: number;
  };
  quality?: FxQualitySummary | null;
  updatedAt?: string;
};

export type FxInitializationRequest = {
  pairId: string;
  startDate: string;
  endDate: string;
  rawTimeframe: "1m";
  targetTimeframes: readonly FxTimeframe[];
  keepRawCsv: boolean;
};

export type FxIncrementalUpdateRequest = {
  pairId: string;
  startDate?: string;
  endDate?: string;
};

export type FxDataControlAction =
  | {
      type: "initialize";
      apiPath: string;
      payload: FxInitializationRequest;
    }
  | {
      type: "update";
      apiPath: string;
      payload: FxIncrementalUpdateRequest;
    }
  | {
      type: "task";
      apiPath: string;
      taskId: string;
      action: FxTaskAction;
    };

export type FxDataControlPanelProps = {
  /** Paths are supplied by the host so this component does not own the data layer. */
  apiPaths: FxDataControlApiPaths;
  /** The host owns polling and passes the latest task snapshot back into the panel. */
  currentTask?: FxDataTask | null;
  /** May be supplied independently when a coverage/quality endpoint is loaded separately. */
  qualitySummary?: FxQualitySummary | null;
  currencyPairs?: readonly FxCurrencyPair[];
  defaultPairId?: string;
  defaultStartDate?: string;
  defaultEndDate?: string;
  datasetLabel?: string;
  instrumentNoun?: string;
  historicalSourceLabel?: string;
  incrementalSourceLabel?: string;
  disabled?: boolean;
  onAction: (action: FxDataControlAction) => void | Promise<void>;
  onActionSettled?: (action: FxDataControlAction) => void | Promise<void>;
  onDataChanged?: () => void | Promise<void>;
  onError?: (error: Error, action: FxDataControlAction) => void;
  onRefreshStatus?: () => void | Promise<void>;
};

const TARGET_TIMEFRAMES: readonly FxTimeframe[] = TIMEFRAME_IDS;
const STAGE_ORDER: readonly FxTaskStage[] = ["download", "parse", "aggregate", "validate", "persist", "completed"];
const STAGE_LABELS: Record<FxTaskStage, string> = {
  queued: "等待",
  download: "下载",
  parse: "解析",
  aggregate: "聚合",
  validate: "校验",
  persist: "入库",
  completed: "完成",
};
const STATUS_LABELS: Record<FxTaskStatus, string> = {
  queued: "等待开始",
  running: "处理中",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败，需要处理",
  cancelled: "已取消",
};
const ACTION_LABELS: Record<FxTaskAction, string> = {
  pause: "暂停",
  resume: "恢复",
  retry: "重试",
  cancel: "取消",
};

type BusyAction = "initialize" | "update" | "refresh" | FxTaskAction;

function asError(value: unknown) {
  return value instanceof Error ? value : new Error(typeof value === "string" ? value : "行情数据任务操作失败");
}
function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function getTaskPercent(task: FxDataTask) {
  if (task.status === "completed") return 100;
  if (typeof task.progress?.percent === "number") return clampPercent(task.progress.percent);
  if (typeof task.progress?.completed === "number" && typeof task.progress.total === "number" && task.progress.total > 0) {
    return clampPercent(task.progress.completed / task.progress.total * 100);
  }
  return clampPercent(task.stageProgress ?? 0);
}

function formatCount(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("zh-CN") : "—";
}

function formatActivityTime(value: string | undefined) {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false }) : value;
}

function getTaskStatusLabel(task: FxDataTask) {
  if (task.status === "queued" && Number(task.progress?.completed ?? 0) > 0) return "等待下一分片";
  return STATUS_LABELS[task.status];
}

function qualityHasIssues(summary: FxQualitySummary) {
  return [summary.invalidRows, summary.duplicateRows, summary.missingIntervals, summary.abnormalJumps]
    .some((value) => typeof value === "number" && value > 0);
}

function hasQualityValues(summary: FxQualitySummary | null | undefined) {
  return Boolean(summary && Object.values(summary).some((value) => value !== undefined && value !== null));
}

export function FxDataControlPanel({
  apiPaths,
  currentTask = null,
  qualitySummary = null,
  currencyPairs = DEFAULT_FX_CURRENCY_PAIRS,
  defaultPairId,
  defaultStartDate = "",
  defaultEndDate = "",
  datasetLabel = "外汇",
  instrumentNoun = "货币对",
  historicalSourceLabel = "Dukascopy CSV",
  incrementalSourceLabel = "Twelve Data REST",
  disabled = false,
  onAction,
  onActionSettled,
  onDataChanged,
  onError,
  onRefreshStatus,
}: FxDataControlPanelProps) {
  const titleId = useId();
  const pairs = useMemo(() => [...currencyPairs], [currencyPairs]);
  const initialPairId = defaultPairId && pairs.some((pair) => pair.id === defaultPairId)
    ? defaultPairId
    : pairs[0]?.id ?? "";
  const [pairId, setPairId] = useState(initialPairId);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [keepRawCsv, setKeepRawCsv] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [notice, setNotice] = useState("");

  const selectedPair = pairs.find((pair) => pair.id === pairId) ?? pairs[0];
  const effectivePairId = selectedPair?.id ?? "";
  const rangeIsValid = Boolean(startDate && endDate && startDate <= endDate);
  const taskIsActive = Boolean(currentTask && ["queued", "running", "paused"].includes(currentTask.status));
  const quality = currentTask?.quality ?? qualitySummary;
  const taskPercent = currentTask ? getTaskPercent(currentTask) : 0;
  const currentStageIndex = currentTask ? STAGE_ORDER.indexOf(currentTask.stage) : -1;
  const busy = busyAction !== null;

  const dispatch = async (action: FxDataControlAction, busyKey: BusyAction, successMessage: string) => {
    setBusyAction(busyKey);
    setNotice("");
    try {
      await onAction(action);
      await onActionSettled?.(action);
      await onDataChanged?.();
      setNotice(successMessage);
    } catch (error) {
      const normalized = asError(error);
      setNotice(normalized.message);
      onError?.(normalized, action);
    } finally {
      setBusyAction(null);
    }
  };

  const initialize = () => {
    if (!effectivePairId) {
      setNotice(`请先传入至少一个可用${instrumentNoun}。`);
      return;
    }
    if (!startDate || !endDate) {
      setNotice("历史初始化需要填写起始日期和结束日期。");
      return;
    }
    if (startDate > endDate) {
      setNotice("起始日期不能晚于结束日期。");
      return;
    }
    void dispatch({
      type: "initialize",
      apiPath: apiPaths.initialize,
      payload: {
        pairId: effectivePairId,
        startDate,
        endDate,
        rawTimeframe: "1m",
        targetTimeframes: TARGET_TIMEFRAMES,
        keepRawCsv,
      },
    }, "initialize", `${historicalSourceLabel} 历史初始化任务已提交。`);
  };

  const update = () => {
    if (!effectivePairId) {
      setNotice(`请先传入至少一个可用${instrumentNoun}。`);
      return;
    }
    void dispatch({
      type: "update",
      apiPath: apiPaths.update,
      payload: {
        pairId: effectivePairId,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      },
    }, "update", `${incrementalSourceLabel} 增量更新任务已提交。`);
  };

  const taskAction = (action: FxTaskAction) => {
    if (!currentTask) return;
    void dispatch({
      type: "task",
      apiPath: apiPaths.task,
      taskId: currentTask.id,
      action,
    }, action, `任务${ACTION_LABELS[action]}请求已提交。`);
  };

  const refreshStatus = () => {
    if (!onRefreshStatus) return;
    setBusyAction("refresh");
    setNotice("");
    void Promise.resolve()
      .then(() => onRefreshStatus())
      .then(() => setNotice("任务状态已刷新。"))
      .catch((error: unknown) => setNotice(asError(error).message))
      .finally(() => setBusyAction(null));
  };

  const canStart = !disabled && !busy && !taskIsActive;
  const canInitialize = canStart && Boolean(effectivePairId) && rangeIsValid;
  const canUpdate = canStart && Boolean(effectivePairId);
  const taskActionDisabled = disabled || busy;
  const taskClassName = currentTask?.status === "completed"
    ? "ready"
    : currentTask?.status === "failed"
      ? "failed"
      : currentTask?.status === "cancelled"
        ? "unavailable"
        : "";

  return (
    <section className="settings-section provider-settings-section" aria-labelledby={titleId} aria-busy={busy}>
      <div className="settings-section-head">
        <strong id={titleId}>{datasetLabel}数据维护</strong>
        <span>{historicalSourceLabel} 建立历史基准，{incrementalSourceLabel} 负责后续增量；组件只提交动作，不直接实现数据层。</span>
      </div>

      <div className="provider-setting-card">
        <div className="provider-setting-title">
          <div>
            <Database size={17} />
            <span><strong>初始化与增量更新</strong><small>统一保存 UTC 的 {TIMEFRAME_IDS.map((value) => timeframeLabel(value)).join(" / ")} {datasetLabel}训练数据</small></span>
          </div>
          <span>{selectedPair?.label ?? `未选择${instrumentNoun}`}</span>
        </div>

        <div className="source-routing">
          <label>{instrumentNoun}
            <select value={effectivePairId} onChange={(event) => setPairId(event.target.value)} disabled={disabled || busy}>
              {pairs.map((pair) => <option key={pair.id} value={pair.id}>{pair.label} · {pair.id}</option>)}
            </select>
          </label>
          <label>原始粒度
            <select value="1m" disabled aria-label="原始粒度">
              <option value="1m">1 分钟（M1）</option>
            </select>
          </label>
          <label>起始日期
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} disabled={disabled || busy} />
          </label>
          <label>结束日期
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} disabled={disabled || busy} />
          </label>
        </div>

        <label className="setup-check">
          <input type="checkbox" checked={keepRawCsv} onChange={(event) => setKeepRawCsv(event.target.checked)} disabled={disabled || busy} />
          <span><strong>保留原始 Dukascopy CSV</strong><small>关闭时只保留解析后的 K 线和质量报告，节省本地磁盘空间。</small></span>
        </label>

        <div className="setup-pipeline" aria-label={`${datasetLabel}数据处理阶段`}>
          {STAGE_ORDER.map((stage, index) => {
            const reached = currentStageIndex >= index || currentTask?.status === "completed";
            return (
              <div key={stage} className={reached ? "active" : ""} aria-current={currentTask?.stage === stage ? "step" : undefined}>
                <span>{reached ? <Check size={12} /> : index + 1}</span>
                <small>{STAGE_LABELS[stage]}</small>
              </div>
            );
          })}
        </div>

        <div className="market-maintenance-actions">
          <button className="primary" type="button" disabled={!canInitialize} onClick={initialize}>
            <CloudDownload size={14} />初始化历史数据
          </button>
          <button type="button" disabled={!canUpdate} onClick={update}>
            <RefreshCw size={14} />增量更新
          </button>
          {onRefreshStatus && (
            <button type="button" disabled={disabled || busy} onClick={refreshStatus}>
              <RefreshCw size={14} />刷新状态
            </button>
          )}
        </div>

        {!pairs.length && <div className="setup-warning">当前没有可用{instrumentNoun}，请由主组件传入 currencyPairs。</div>}
        {!rangeIsValid && <small className="provider-setting-help">历史初始化需要有效的日期范围；增量更新日期可留空，留空时由服务端从最后一根完整 M1 K 线继续。</small>}
      </div>

      <div className={`market-maintenance-card ${taskClassName}`}>
        <div className="market-maintenance-icon"><Database size={22} /></div>
        <div>
          <span>FX DATA TASK · {currentTask?.mode === "update" ? "INCREMENTAL" : "HISTORY"}</span>
          <strong>{currentTask
            ? `${currentTask.pairLabel ?? selectedPair?.label ?? currentTask.pairId} · ${getTaskStatusLabel(currentTask)}`
            : `尚未启动${datasetLabel}任务`}</strong>
          <small>{currentTask?.error || currentTask?.message || `选择${instrumentNoun}和日期后，可以创建 ${historicalSourceLabel} 历史初始化或 ${incrementalSourceLabel} 增量任务。`}</small>

          {currentTask && (
            <>
              <div
                className="local-task-progress"
                role="progressbar"
                aria-label="外汇任务总进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(taskPercent)}
              >
                <i style={{ width: `${taskPercent}%` }} />
              </div>
              <small className="maintenance-task-summary">
                {formatCount(currentTask.progress?.completed)} / {formatCount(currentTask.progress?.total)} {currentTask.progress?.unit ?? "项"}
                {" · "}当前阶段：{STAGE_LABELS[currentTask.stage]} {typeof currentTask.stageProgress === "number" ? `${Math.round(clampPercent(currentTask.stageProgress))}%` : ""}
                {" · "}最近活动：{formatActivityTime(currentTask.updatedAt)}
              </small>
            </>
          )}

          {currentTask?.error && (
            <div className="task-error" role="alert">
              <strong><AlertCircle size={13} />任务错误</strong>
              <span>{currentTask.error}</span>
            </div>
          )}
        </div>
        <div className="market-maintenance-actions">
          {currentTask && ["queued", "running"].includes(currentTask.status) && (
            <button type="button" className="danger" disabled={taskActionDisabled} onClick={() => taskAction("pause")}>
              <Pause size={14} />暂停
            </button>
          )}
          {currentTask?.status === "paused" && (
            <button type="button" className="primary" disabled={taskActionDisabled} onClick={() => taskAction("resume")}>
              <Play size={14} />恢复
            </button>
          )}
          {currentTask?.status === "failed" && (
            <button type="button" className="primary" disabled={taskActionDisabled} onClick={() => taskAction("retry")}>
              <RefreshCw size={14} />重试
            </button>
          )}
          {currentTask && ["queued", "running", "paused"].includes(currentTask.status) && (
            <button type="button" className="danger" disabled={taskActionDisabled} onClick={() => taskAction("cancel")}>
              <XCircle size={14} />取消
            </button>
          )}
        </div>
      </div>

      {hasQualityValues(quality) && (
        <div className="provider-setting-card">
          <div className="provider-setting-title">
            <div>
              <AlertCircle size={17} />
              <span><strong>质量摘要</strong><small>重复、缺口、非法 OHLC 和异常跳变不会静默忽略</small></span>
            </div>
            <span className={quality && !qualityHasIssues(quality) ? "configured" : ""}>
              {quality && qualityHasIssues(quality) ? "需要关注" : "校验通过"}
            </span>
          </div>
          <div className="local-task-metrics">
            <span><strong>{formatCount(quality?.acceptedRows)}</strong><small>接受行数</small></span>
            <span><strong>{formatCount(quality?.insertedBars)}</strong><small>写入 K 线</small></span>
            <span><strong>{formatCount(quality?.invalidRows)}</strong><small>非法行</small></span>
            <span><strong>{formatCount(quality?.duplicateRows)}</strong><small>重复行</small></span>
            <span><strong>{formatCount(quality?.missingIntervals)}</strong><small>缺口</small></span>
          </div>
          <small className="maintenance-task-summary">
            来源：{quality?.source ?? "—"}
            {" · "}覆盖：{quality?.earliestTimestamp ?? "—"} — {quality?.latestTimestamp ?? "—"}
            {" · "}历史切换点：{quality?.historyBoundary ?? "—"}
            {quality?.checkedAt ? ` · 最近校验：${quality.checkedAt}` : ""}
          </small>
        </div>
      )}

      {notice && <div className="status-banner" role="status">{notice}</div>}
    </section>
  );
}
