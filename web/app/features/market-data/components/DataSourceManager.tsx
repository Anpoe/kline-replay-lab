"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleCheck,
  CloudDownload,
  Database,
  FileArchive,
  HardDrive,
  Pause,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_FX_CURRENCY_PAIRS,
  DEFAULT_GOLD_INSTRUMENTS,
  FxDataControlPanel,
  type FxDataControlAction,
  type FxDataTask,
  type FxQualitySummary,
} from "./FxDataControlPanel";
import { acceptsMarketDataResponse, normalizeMarketDataError } from "../marketDataController";
import type { DataMarket } from "../marketDataContracts";
import {
  createMarketDataGateway,
  createMarketDataStorageGateway,
} from "../marketDataGateway";
import {
  isMarketSyncTerminalStatus,
  shouldRefreshMarketSyncJobs,
} from "../../../lib/marketSyncWorkerCoordinator.ts";
import { chooseUsSyncMode } from "../marketDataMode.ts";
import { TIMEFRAME_IDS, timeframeLabel as catalogTimeframeLabel, type TimeframeId } from "../../../lib/timeframeCatalog";

// The worker route remains the polling transport behind marketDataGateway: /api/data-jobs/market/sync/worker.

type DownloadProviderId = "tushare" | "alpaca";
type ProviderId = DownloadProviderId | "baostock" | "tdxquant" | "twelvedata" | "dukascopy";
type Provider = {
  id: ProviderId;
  name: string;
  market: string;
  configured: boolean;
  supportedTimeframes: string[];
};
type DownloadJob = {
  id: string;
  provider: DownloadProviderId;
  instrumentId: string;
  vendorSymbol: string;
  instrumentName: string;
  market: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  status: "queued" | "running" | "paused" | "completed" | "failed" | "no_data" | "superseded" | "cancelled";
  insertedCount: number;
  qualityReportJson: string;
  lastError?: string;
  syncRunId?: string | null;
  syncBatchId?: string | null;
  feed?: "sip" | "iex" | null;
  attemptCount?: number;
  terminalReason?: string | null;
  updatedAt: string;
};
type DownloadJobSummary = {
  total: number;
  queued: number;
  running: number;
  paused: number;
  completed: number;
  failed: number;
  insertedCount: number;
};
type LegacyUsDataSummary = {
  needsRebuild: boolean;
  instrumentCount: number;
  barCount: number;
  firstTimestamp?: number | null;
  lastTimestamp?: number | null;
};
type JobRunResult = {
  status: DownloadJob["status"];
  insertedCount: number;
};
type MarketSyncStatus = {
  run: {
    id: string;
    mode: "initialize" | "update";
    status: "queued" | "running" | "paused" | "completed" | "completed_with_errors" | "failed" | "cancelled";
    feed: "sip" | "iex";
    totalSymbols: number;
    completedSymbols: number;
    failedSymbols: number;
    totalBatches: number;
    completedBatches: number;
    insertedCount: number;
    skippedSymbols: number;
    lastError?: string | null;
    updatedAt: string;
  };
  currentBatch?: {
    batchNo: number;
    symbolCount: number;
    startDate: string;
    endDate: string;
    sessionCount: number;
    estimatedPoints: number;
    attemptCount: number;
    insertedCount: number;
    lastError?: string | null;
  } | null;
  pendingBatches: number;
  runningBatches: number;
  failedBatches: number;
};
type LocalDataTask = {
  id: string;
  status: "queued" | "running" | "paused" | "completed" | "failed";
  stage: "waiting" | "cataloging" | "downloading" | "verifying" | "extracting" | "adjusting" | "weekly-ready" | "completed";
  message: string;
  error?: string | null;
  progress: {
    downloadedBytes: number;
    totalBytes: number;
    processedFiles: number;
    totalFiles: number;
    indexedInstruments: number;
    adjustmentProcessed?: number;
    adjustmentTotal?: number;
    adjustmentRows?: number;
    adjustmentMissing?: number;
    totalInstruments?: number;
    processedInstruments?: number;
    receivedBars?: number;
    acceptedBars?: number;
    insertedBars?: number;
    correctedBars?: number;
    unchangedBars?: number;
    skippedInstruments?: number;
    invalidBars?: number;
  };
  plan?: {
    assets?: string[];
    includeDelisted?: boolean;
    historyRange?: "all" | "20y" | "10y";
    keepRawPackage?: boolean;
    adjustmentType?: "qfq" | "hfq" | "none" | "provider-defined";
    source?: string;
    provider?: string;
  };
  updatedAt: string;
};
type LocalDatasetStatus = {
  source?: string | null;
  adjustmentType?: "qfq" | "hfq" | "none" | "provider-defined";
  adjustmentStatus?: "pending" | "building" | "ready" | "not-adjusted";
  adjustmentSource?: string | null;
  adjustmentUpdatedAt?: string | null;
  factorCount?: number;
};
type CatalogTask = {
  id: string;
  status: "running" | "paused" | "completed" | "failed";
  processed: number;
  total: number;
  resolved: number;
  message: string;
  error?: string | null;
};
type CnMaintenanceTask = {
  id: string;
  mode: "incremental" | "repair";
  status: "queued" | "running" | "paused" | "completed" | "failed";
  message: string;
  error?: string | null;
  nextDateIndex: number;
  progress: {
    processedDates: number;
    totalDates: number;
    receivedRows: number;
    acceptedRows: number;
    insertedBars: number;
    correctedBars: number;
    unchangedBars: number;
    factorRows?: number;
    ignoredRows: number;
    invalidRows: number;
  };
  updatedAt: string;
};
type SetupView = "welcome" | "quick" | "advanced" | "manager";
type AdvancedSetup = {
  cnMarket: boolean;
  usMarket: boolean;
  stocks: boolean;
  indices: boolean;
  funds: boolean;
  convertibleBonds: boolean;
  includeDelisted: boolean;
  minimumTimeframe: TimeframeId;
  historyRange: "all" | "20y" | "10y";
  cnInitialSource: "baostock" | "tdxquant" | "tdx-zip" | "tushare";
  cnIncrementalSource: "baostock" | "tushare" | "tdxquant" | "none";
  usSource: "none" | "alpaca";
  keepRawPackage: boolean;
};

const defaultAdvancedSetup: AdvancedSetup = {
  cnMarket: true,
  usMarket: false,
  stocks: true,
  indices: true,
  funds: false,
  convertibleBonds: false,
  includeDelisted: true,
  minimumTimeframe: "1d",
  historyRange: "all",
  cnInitialSource: "baostock",
  cnIncrementalSource: "baostock",
  usSource: "none",
  keepRawPackage: false,
};

const quickPlan = {
  kind: "quick",
  cnMarket: true,
  usMarket: false,
  assets: ["A股股票（含退市）", "交易所指数"],
  minimumTimeframe: "1d",
  derivedTimeframes: ["1w"],
  source: "BaoStock 前复权日线",
  catalog: "BaoStock 品种目录",
  snapshotPolicy: "仅保存变化分区和训练引用版本",
  keepRawPackage: false,
};

function statusLabel(status: DownloadJob["status"]) {
  return {
    queued: "等待下载",
    running: "下载中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    no_data: "无数据",
    superseded: "已被替换",
    cancelled: "已取消",
  }[status];
}

function timeframeLabel(value: AdvancedSetup["minimumTimeframe"]) {
  if (value === "5m") return `${catalogTimeframeLabel(value)}（自动生成 M15、M30、H1、H4、D1、W1、MN）`;
  if (value === "1h") return `${catalogTimeframeLabel(value)}（自动生成 H4、D1、W1、MN）`;
  if (value === "1d") return `${catalogTimeframeLabel(value)}（自动生成 W1、MN）`;
  return catalogTimeframeLabel(value);
}

const DIRECT_SETUP_TIMEFRAMES = new Set<TimeframeId>(["5m", "1h", "1d"]);

function SetupProgress({ step }: { step: number }) {
  return (
    <div className="setup-progress" aria-label={`高级自定义第 ${step} 步，共 4 步`}>
      {["市场与品种", "周期与范围", "数据来源", "确认方案"].map((label, index) => (
        <div className={index + 1 <= step ? "active" : ""} key={label}>
          <span>{index + 1 < step ? <Check size={12} /> : index + 1}</span>
          <small>{label}</small>
        </div>
      ))}
    </div>
  );
}

export function DataSourceManager({
  market,
  hasData = false,
  onDataChanged,
  onOpenSettings,
}: {
  market: DataMarket;
  hasData?: boolean;
  onDataChanged?: (market: DataMarket) => void;
  onOpenSettings?: () => void;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [jobSummary, setJobSummary] = useState<DownloadJobSummary>({
    total: 0,
    queued: 0,
    running: 0,
    paused: 0,
    completed: 0,
    failed: 0,
    insertedCount: 0,
  });
  const [marketNotices, setMarketNotices] = useState<Record<DataMarket, string>>({ CN: "", US: "", FX: "", GOLD: "" });
  const [marketSync, setMarketSync] = useState<MarketSyncStatus | null>(null);
  const [legacyUsData, setLegacyUsData] = useState<LegacyUsDataSummary | null>(null);
  const [marketSyncBusy, setMarketSyncBusy] = useState(false);
  const [setupView, setSetupView] = useState<SetupView>(market === "CN" ? "welcome" : "manager");
  const [setupOpenedByUser, setSetupOpenedByUser] = useState(false);
  // Existing data should choose the manager as the initial view, but must not
  // prevent the user from reopening the initialization wizard afterwards.
  const effectiveSetupView: SetupView = market !== "CN"
    ? "manager"
    : hasData && !setupOpenedByUser && setupView === "welcome"
      ? "manager"
      : setupView;
  const [advancedStep, setAdvancedStep] = useState(1);
  const [advanced, setAdvanced] = useState<AdvancedSetup>(defaultAdvancedSetup);
  const [savedPlan, setSavedPlan] = useState<Record<string, unknown> | null>(null);
  const [localTask, setLocalTask] = useState<LocalDataTask | null>(null);
  const [localDataset, setLocalDataset] = useState<LocalDatasetStatus | null>(null);
  const [localServiceError, setLocalServiceError] = useState("");
  const [catalogTask, setCatalogTask] = useState<CatalogTask | null>(null);
  const [cnMaintenanceTask, setCnMaintenanceTask] = useState<CnMaintenanceTask | null>(null);
  const [fxTask, setFxTask] = useState<FxDataTask | null>(null);
  const [fxQuality, setFxQuality] = useState<FxQualitySummary | null>(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [localServiceAvailable, setLocalServiceAvailable] = useState(true);
  const aliveRef = useRef(true);
  const marketSyncLoopRef = useRef<string | null>(null);
  const fxTaskLoopRef = useRef<string | null>(null);
  const localServiceAvailableRef = useRef(true);
  const activeMarketRef = useRef(market);
  const marketDataGateway = useMemo(
    () => createMarketDataGateway((input, init) => fetch(input, init)),
    [],
  );
  const marketDataStorageGateway = useMemo(
    () => createMarketDataStorageGateway(
      typeof window === "undefined"
        ? {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          }
        : window.localStorage,
    ),
    [],
  );

  useEffect(() => {
    activeMarketRef.current = market;
  }, [market]);

  const setNotice = useCallback((message: string) => {
    setMarketNotices((current) => current[market] === message
      ? current
      : { ...current, [market]: message });
  }, [market]);
  const notice = marketNotices[market];
  const notifyDataChanged = useCallback(() => {
    if (activeMarketRef.current !== market) return;
    onDataChanged?.(market);
  }, [market, onDataChanged]);

  const loadProviders = useCallback(async () => {
    try {
      const data = await marketDataGateway.loadProviders<{ providers: Provider[] }>();
      setProviders(data.providers);
    } catch {
      // Keep the previous provider state while the settings endpoint is unavailable.
    }
  }, [marketDataGateway]);

  const loadJobs = useCallback(async () => {
    const requestMarket = market;
    try {
      const data = await marketDataGateway.loadJobs<{
        jobs: DownloadJob[];
        summary?: Partial<DownloadJobSummary>;
        legacy?: LegacyUsDataSummary | null;
      }>(requestMarket);
      if (!acceptsMarketDataResponse(activeMarketRef.current, requestMarket)) return;
      setJobs(data.jobs);
      setLegacyUsData(requestMarket === "US" && data.legacy
        ? {
            needsRebuild: Boolean(data.legacy.needsRebuild),
            instrumentCount: Number(data.legacy.instrumentCount ?? 0),
            barCount: Number(data.legacy.barCount ?? 0),
            firstTimestamp: data.legacy.firstTimestamp == null ? null : Number(data.legacy.firstTimestamp),
            lastTimestamp: data.legacy.lastTimestamp == null ? null : Number(data.legacy.lastTimestamp),
          }
        : null);
      setJobSummary({
        total: Number(data.summary?.total ?? 0),
        queued: Number(data.summary?.queued ?? 0),
        running: Number(data.summary?.running ?? 0),
        paused: Number(data.summary?.paused ?? 0),
        completed: Number(data.summary?.completed ?? 0),
        failed: Number(data.summary?.failed ?? 0),
        insertedCount: Number(data.summary?.insertedCount ?? 0),
      });
    } catch {
      // A stale job list is safer than clearing the active market's task state.
    }
  }, [market, marketDataGateway]);

  const loadMarketSync = useCallback(async (runId?: string) => {
    if (market !== "US") return null;
    const requestMarket = market;
    try {
      const data = await marketDataGateway.loadMarketSync<{
        run?: MarketSyncStatus["run"] | null;
        currentBatch?: MarketSyncStatus["currentBatch"];
        pendingBatches?: number;
        runningBatches?: number;
        failedBatches?: number;
      }>(runId);
      if (!acceptsMarketDataResponse(activeMarketRef.current, requestMarket)) return null;
      if (!data.run) {
        setMarketSync(null);
        return null;
      }
      const next: MarketSyncStatus = {
        run: data.run,
        currentBatch: data.currentBatch ?? null,
        pendingBatches: Number(data.pendingBatches ?? 0),
        runningBatches: Number(data.runningBatches ?? 0),
        failedBatches: Number(data.failedBatches ?? 0),
      };
      setMarketSync(next);
      return next;
    } catch {
      return null;
    }
  }, [market, marketDataGateway]);

  const loadLocalTask = useCallback(async () => {
    try {
      const data = await marketDataGateway.loadLocalTask<{
        available?: boolean;
        task?: LocalDataTask | null;
        dataset?: LocalDatasetStatus | null;
        error?: string;
      }>();
      const available = Boolean(data.available);
      const recovered = !localServiceAvailableRef.current && available;
      localServiceAvailableRef.current = available;
      setLocalServiceAvailable(available);
      setLocalTask(data.task ?? null);
      setLocalDataset(data.dataset ?? null);
      setLocalServiceError(available ? "" : data.error ?? "");
      return { available, recovered };
    } catch (error) {
      localServiceAvailableRef.current = false;
      setLocalServiceAvailable(false);
      setLocalTask(null);
      setLocalDataset(null);
      setLocalServiceError(error instanceof Error && error.message
        ? error.message
        : "本机数据服务未启动。请关闭当前窗口后重新启动本地控制面板。");
      return { available: false, recovered: false };
    }
  }, [marketDataGateway]);

  const loadCatalogTask = useCallback(async () => {
    try {
      const data = await marketDataGateway.loadCatalogTask<{ catalogTask?: CatalogTask | null }>();
      const task = data.catalogTask ?? null;
      setCatalogTask(task);
      return task;
    } catch {
      // 本机数据服务不可用时由主状态卡统一提示。
      return null;
    }
  }, [marketDataGateway]);

  const loadCnMaintenanceTask = useCallback(async () => {
    try {
      const data = await marketDataGateway.loadCnMaintenanceTask<{ maintenanceTask?: CnMaintenanceTask | null }>();
      const task = data.maintenanceTask ?? null;
      setCnMaintenanceTask(task);
      return task;
    } catch {
      return null;
    }
  }, [marketDataGateway]);

  const loadFxTask = useCallback(async () => {
    if (market !== "FX" && market !== "GOLD") return null;
    try {
      const pairId = market === "GOLD" ? "XAUUSD.GOLD" : undefined;
      const data = await marketDataGateway.loadFxTask<{ task?: FxDataTask | null; qualitySummary?: FxQualitySummary | null }>(pairId);
      const task = data.task ?? null;
      setFxTask(task);
      setFxQuality(data.qualitySummary ?? task?.quality ?? null);
      return task;
    } catch {
      return null;
    }
  }, [market, marketDataGateway]);

  useEffect(() => {
    aliveRef.current = true;
    const timer = window.setTimeout(() => {
      const stored = marketDataStorageGateway.loadOnboardingPlan<Record<string, unknown>>();
      if (stored) {
        setSavedPlan(stored);
        setSetupView("manager");
      }
      void Promise.all([
        loadProviders(),
        loadJobs(),
        loadMarketSync(),
        loadLocalTask(),
        loadCatalogTask(),
        loadCnMaintenanceTask(),
        loadFxTask(),
      ]);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      aliveRef.current = false;
    };
  }, [loadCatalogTask, loadCnMaintenanceTask, loadFxTask, loadJobs, loadLocalTask, loadMarketSync, loadProviders, marketDataStorageGateway]);

  useEffect(() => {
    if (market !== "CN" || !localTask || !["queued", "running"].includes(localTask.status)) return;
    const timer = window.setInterval(() => {
      void loadLocalTask().then(notifyDataChanged);
    }, 900);
    return () => window.clearInterval(timer);
  }, [loadLocalTask, localTask, market, notifyDataChanged]);

  useEffect(() => {
    if (market !== "CN") return;
    const timer = window.setInterval(() => {
      void loadLocalTask().then((result) => {
        if (result.recovered) notifyDataChanged();
      });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [loadLocalTask, market, notifyDataChanged]);

  useEffect(() => {
    if (market !== "CN" || catalogTask?.status !== "running") return;
    const timer = window.setInterval(() => {
      void loadCatalogTask().then((task) => {
        if (task?.status === "completed") notifyDataChanged();
      });
    }, 1200);
    return () => window.clearInterval(timer);
  }, [catalogTask, loadCatalogTask, market, notifyDataChanged]);

  useEffect(() => {
    if (market !== "CN" || !cnMaintenanceTask || !["queued", "running"].includes(cnMaintenanceTask.status)) return;
    const timer = window.setInterval(() => {
      void loadCnMaintenanceTask().then((task) => {
        if (task?.status === "completed") notifyDataChanged();
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cnMaintenanceTask, loadCnMaintenanceTask, market, notifyDataChanged]);

  useEffect(() => {
    const reload = () => {
      void loadProviders();
    };
    window.addEventListener("provider-settings-updated", reload);
    return () => window.removeEventListener("provider-settings-updated", reload);
  }, [loadProviders]);

  const configured = useMemo(
    () => Object.fromEntries(providers.map((provider) => [provider.id, provider.configured])) as Partial<Record<ProviderId, boolean>>,
    [providers],
  );
  const marketJobs = useMemo(
    () => jobs.filter((job) => job.market === market),
    [jobs, market],
  );
  const usStarted = market === "US" && (jobSummary.total > 0 || Boolean(marketSync));
  const usPending = market === "US" && marketSync
    ? Math.max(0, marketSync.run.totalSymbols - marketSync.run.completedSymbols - marketSync.run.failedSymbols)
    : market === "US"
      ? jobSummary.queued + jobSummary.running + jobSummary.paused
      : 0;
  const usRemaining = usPending + (market === "US" && !marketSync ? jobSummary.failed : 0);
  const usNeedsRebuild = market === "US" && Boolean(legacyUsData?.needsRebuild);
  const usInitialized = market === "US"
    && !usNeedsRebuild
    && ((marketSync?.run.status === "completed" && marketSync.run.failedSymbols === 0)
      || (!marketSync && usStarted && usRemaining === 0));

  const saveSetupPlan = (plan: Record<string, unknown>, message: string) => {
    marketDataStorageGateway.saveOnboardingPlan(plan);
    setSavedPlan(plan);
    setNotice(message);
    setSetupOpenedByUser(false);
    setSetupView("manager");
  };

  const startLocalInitialization = async (
    saved: Record<string, unknown>,
    plan: Record<string, unknown>,
  ) => {
    setNotice("正在连接本机数据服务并创建可恢复初始化任务……");
    try {
      const result = await marketDataGateway.startLocalInitialization<{ task?: LocalDataTask; error?: string }>(plan);
      if (!result.task) throw new Error(result.error ?? "初始化任务创建失败");
      marketDataStorageGateway.saveOnboardingPlan(saved);
      setSavedPlan(saved);
      setLocalTask(result.task);
      setLocalServiceAvailable(true);
      setLocalServiceError("");
      setNotice("初始化任务已开始。关闭网页不会丢失进度；再次打开后可以继续查看。");
      setSetupOpenedByUser(false);
      setSetupView("manager");
    } catch (error) {
      setNotice(normalizeMarketDataError(error, "无法启动本机初始化任务"));
    }
  };

  const updateLocalTask = async (action: "pause" | "resume") => {
    try {
      const result = await marketDataGateway.localTaskAction<{ task?: LocalDataTask; error?: string }>(action);
      if (!result.task) throw new Error(result.error ?? "任务操作失败");
    setLocalTask(result.task ?? null);
    setNotice(action === "pause" ? "任务已请求暂停，当前进度会保留。" : "任务已继续。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "任务操作失败");
    }
  };

  const removeLocalTaskRecord = async () => {
    if (!window.confirm("移除这条初始化任务记录？已经导入的行情文件会保留。")) return;
    try {
      await marketDataGateway.removeLocalTask(false);
      setLocalTask(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "移除初始化任务失败");
    }
  };

  const refreshCatalog = async () => {
    setNotice("正在启动中文名称目录更新；期间仍可继续使用训练功能。");
    try {
      const result = await marketDataGateway.localTaskAction<{ catalogTask?: CatalogTask; error?: string }>("catalog-refresh");
      if (!result.catalogTask) throw new Error(result.error ?? "名称目录更新启动失败");
      setCatalogTask(result.catalogTask);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "名称目录更新启动失败");
    }
  };

  const updateCnMaintenance = async (
    action: "start" | "pause" | "resume",
    mode: "incremental" | "repair" = "incremental",
  ) => {
    if (action === "start") {
      const prompt = localUsesBaoStock
        ? mode === "incremental"
          ? "系统将从本地最后日期之后，使用 BaoStock 拉取全市场股票前复权日线。确定开始吗？"
          : "系统将回查最近 30 个自然日，使用 BaoStock 修复 A 股前复权日线缺口；停牌和休市不会造数据。确定开始吗？"
        : mode === "incremental"
          ? "系统将从本地最后日期之后，使用 Tushare daily 拉取 A 股不复权日线。确定开始吗？"
          : "系统将回查最近 30 个自然日，使用 Tushare daily 修复 A 股不复权日线缺口。确定开始吗？";
      if (!window.confirm(prompt)) return;
    }
    setMaintenanceBusy(true);
    setNotice(action === "pause"
      ? "正在安全暂停 A 股维护任务……"
      : mode === "repair" ? "正在建立最近 30 日缺口回查任务……" : "正在建立每日增量任务……");
    try {
      const result = await marketDataGateway.cnMaintenanceAction<{
        maintenanceTask?: CnMaintenanceTask | null;
        error?: string;
      }>(action, mode, 30);
      setCnMaintenanceTask(result.maintenanceTask ?? null);
      setNotice(action === "pause"
        ? "任务已暂停，已经写入的日期和游标均已保存。"
        : result.maintenanceTask?.message ?? "任务已开始。");
      if (result.maintenanceTask?.status === "completed") notifyDataChanged();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "A 股维护任务操作失败");
    } finally {
      setMaintenanceBusy(false);
    }
  };

  const runJob = async (id: string): Promise<JobRunResult> => {
    setNotice("正在分批下载并校验 K 线，可以随时暂停。");
    try {
      while (aliveRef.current) {
        const result = await marketDataGateway.runDownloadJob<{
          status?: DownloadJob["status"];
          complete?: boolean;
          insertedCount?: number;
          error?: string;
        }>(id);
        await loadJobs();
        if (result.complete || result.status === "paused" || result.status === "completed") {
          const finalStatus = result.status ?? (result.complete ? "completed" : "queued");
          setNotice(finalStatus === "paused"
            ? "任务已暂停，下载游标和已导入数据均已保存。"
            : `下载完成，累计处理 ${Number(result.insertedCount ?? 0).toLocaleString()} 根 K 线。`);
          notifyDataChanged();
          return {
            status: finalStatus,
            insertedCount: Number(result.insertedCount ?? 0),
          };
        }
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "下载失败");
      await loadJobs();
      return { status: "failed", insertedCount: 0 };
    }
    return { status: "paused", insertedCount: 0 };
  };

  const refreshCnMarket = async () => {
    if (!localTask || localTask.status !== "completed") {
      setNotice("请先完成 A 股全市场日线初始化。");
      return;
    }
    const source = localTask.plan?.source ?? (localDataset?.source?.startsWith("tdx") ? "tdx-zip" : "baostock");
    const usesBaoStock = source === "baostock";
    if (!window.confirm(usesBaoStock
      ? "重新从 BaoStock 拉取 A 股前复权历史数据？新任务会替换现有 BaoStock A 股数据。"
      : "重新从通达信官方日线包拉取 A 股数据？该旧方案保持不复权，原有 BaoStock 数据不会被删除。")) return;
    setNotice(usesBaoStock
      ? "正在创建 BaoStock A 股市场更新任务；训练数据会统一切换到新版本。"
      : "正在创建通达信 A 股市场更新任务；旧方案数据保持不复权。"
    );
    try {
      await marketDataGateway.removeLocalTask(false);
    } catch {
      setNotice("无法重置上一条更新任务，请重新启动本地网页版后再试。");
      return;
    }
    setLocalTask(null);
    const saved = savedPlan ?? { ...quickPlan, createdAt: new Date().toISOString() };
    await startLocalInitialization(saved, {
      assets: localTask.plan?.assets ?? ["stock", "index"],
      includeDelisted: localTask.plan?.includeDelisted ?? true,
      historyRange: localTask.plan?.historyRange ?? "all",
      keepRawPackage: localTask.plan?.keepRawPackage ?? false,
      source,
      provider: usesBaoStock ? "baostock" : "tdx",
      adjustmentType: usesBaoStock ? "qfq" : "none",
    });
  };

  const runMarketSync = useCallback(async (runId: string) => {
    if (marketSyncLoopRef.current === runId) return;
    marketSyncLoopRef.current = runId;
    setMarketSyncBusy(true);
    let networkFailures = 0;
    let lastJobsRefreshAt = Date.now();
    try {
      while (aliveRef.current) {
        let data: {
          run?: MarketSyncStatus["run"];
          currentBatch?: MarketSyncStatus["currentBatch"];
          pendingBatches?: number;
          runningBatches?: number;
          failedBatches?: number;
          error?: string;
        } | null = null;
        try {
          data = await marketDataGateway.marketSyncWorker<{
            run?: MarketSyncStatus["run"];
            currentBatch?: MarketSyncStatus["currentBatch"];
            pendingBatches?: number;
            runningBatches?: number;
            failedBatches?: number;
            error?: string;
          }>(runId);
        } catch (error) {
          networkFailures += 1;
          setNotice(error instanceof Error ? error.message : "美股批次执行网络失败，正在等待后重试");
          if (networkFailures >= 5) break;
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          continue;
        }
        if (!data?.run) {
          networkFailures += 1;
          setNotice(data?.error ?? "美股批次执行失败，正在等待后重试");
          if (networkFailures >= 5) break;
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          continue;
        }
        networkFailures = 0;
        const next: MarketSyncStatus = {
          run: data.run,
          currentBatch: data.currentBatch ?? null,
          pendingBatches: Number(data.pendingBatches ?? 0),
          runningBatches: Number(data.runningBatches ?? 0),
          failedBatches: Number(data.failedBatches ?? 0),
        };
        setMarketSync(next);
        const title = next.run.mode === "initialize" ? "美股历史初始化" : "美股最新日线更新";
        const failed = next.run.failedSymbols
          ? "，失败 " + next.run.failedSymbols.toLocaleString() + " 个"
          : "";
        setNotice(title + "：" +
          next.run.completedSymbols.toLocaleString() + " / " +
          next.run.totalSymbols.toLocaleString() + " 个品种，完成 " +
          next.run.completedBatches.toLocaleString() + " / " +
          next.run.totalBatches.toLocaleString() + " 批，写入 " +
          next.run.insertedCount.toLocaleString() + " 根 K 线" + failed);
        const terminal = isMarketSyncTerminalStatus(next.run.status);
        if (!terminal && shouldRefreshMarketSyncJobs(next.run.status, lastJobsRefreshAt, Date.now())) {
          lastJobsRefreshAt = Date.now();
          try {
            await loadJobs();
          } catch {
            // A status update must continue even if the auxiliary job list is offline.
          }
        }
        if (terminal) {
          notifyDataChanged();
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    } finally {
      marketSyncLoopRef.current = null;
      setMarketSyncBusy(false);
      try {
        await loadMarketSync(runId);
      } catch {
        // Keep the persisted run resumable even when the final refresh is offline.
      }
      try {
        await loadJobs();
      } catch {
        // The next status poll can refresh the job list after a transient failure.
      }
    }
  }, [loadJobs, loadMarketSync, marketDataGateway, notifyDataChanged, setNotice]);

  const syncUsMarket = async (mode: "initialize" | "update") => {
    if (!configured.alpaca) {
      setNotice("请先进入“设置 → 数据源设置”配置 Alpaca 免费账户密钥。");
      return;
    }
    const message = mode === "initialize"
      ? usNeedsRebuild
        ? `检测到 ${legacyUsData?.instrumentCount.toLocaleString() ?? "部分"} 个品种仍只有旧版未复权数据。旧数据不会直接改名，系统将重新下载 Alpaca 全复权历史；任务可能较多，可以随时暂停，确定继续吗？`
        : "初始化会读取 Alpaca 的活跃可交易美股目录，并从 2016 年开始批量下载 SIP/IEX 全复权日线。任务可能较多，可以随时暂停，确定继续吗？"
      : "只同步最新已收盘日线：服务端会根据缺失交易日和 URL 长度自动计算批量。不会删除旧训练快照，确定继续吗？";
    if (!window.confirm(message)) return;
    try {
    setMarketSyncBusy(true);
    setNotice(mode === "initialize"
      ? "正在创建可恢复的美股历史初始化任务……"
      : "正在创建可恢复的美股最新日线任务……");
    const result = await marketDataGateway.startMarketSync<{
      run?: MarketSyncStatus["run"];
      currentBatch?: MarketSyncStatus["currentBatch"];
      pendingBatches?: number;
      runningBatches?: number;
      failedBatches?: number;
      error?: string;
    }>("US", mode);
    if (!result.run) {
      setMarketSyncBusy(false);
      setNotice(result.error ?? "美股同步任务创建失败");
      return;
    }
    const created: MarketSyncStatus = {
      run: result.run,
      currentBatch: result.currentBatch ?? null,
      pendingBatches: Number(result.pendingBatches ?? 0),
      runningBatches: Number(result.runningBatches ?? 0),
      failedBatches: Number(result.failedBatches ?? 0),
    };
    setMarketSync(created);
    try {
      await loadJobs();
    } catch {
      // The worker can start even when the auxiliary list refresh is offline.
    }
    void runMarketSync(created.run.id);
    return;
    } catch (error) {
      setMarketSyncBusy(false);
      setNotice(error instanceof Error ? error.message : "美股同步任务创建失败");
    }

  };

  const controlUsMarketSync = async (action: "pause" | "resume" | "cancel" | "retry") => {
    const runId = marketSync?.run.id;
    if (!runId) return;
    setMarketSyncBusy(true);
    try {
      const result = await marketDataGateway.marketSyncAction<{ run?: MarketSyncStatus["run"]; error?: string }>(runId, action);
      if (!result.run) throw new Error(result.error ?? "美股同步任务操作失败");
      await loadMarketSync(runId);
      if (action === "resume" || action === "retry") void runMarketSync(runId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "美股同步任务操作失败");
      setMarketSyncBusy(false);
    }
  };

  useEffect(() => {
    const run = market === "US" ? marketSync?.run : null;
    if (!run || !["queued", "running"].includes(run.status)) return;
    if (marketSyncLoopRef.current !== run.id) void runMarketSync(run.id);
  }, [market, marketSync?.run, runMarketSync]);

  const runFxTask = useCallback(async (taskId: string) => {
    if (fxTaskLoopRef.current === taskId) return;
    fxTaskLoopRef.current = taskId;
    let failures = 0;
    let retryDelayMs = 250;
    try {
      while (aliveRef.current) {
        try {
          const data = await marketDataGateway.runFxTask<{ task?: FxDataTask | null; error?: string }>(taskId);
          if (data.task) {
            setFxTask(data.task);
            setFxQuality(data.task.quality ?? null);
          }
          if (data.task && ["completed", "failed", "cancelled", "paused"].includes(data.task.status)) {
            if (data.task.status === "completed") notifyDataChanged();
            break;
          }
          if (!data.task) {
            failures += 1;
            retryDelayMs = Math.min(30_000, 1_000 * 2 ** Math.min(failures - 1, 5));
            setNotice(`${data.error ?? `${market === "GOLD" ? "黄金" : "外汇"}任务请求暂时失败`}，${Math.ceil(retryDelayMs / 1_000)} 秒后自动重试（第 ${failures} 次）`);
          } else {
            if (failures) setNotice("");
            failures = 0;
            retryDelayMs = 250;
          }
        } catch (error) {
          failures += 1;
          retryDelayMs = Math.min(30_000, 1_000 * 2 ** Math.min(failures - 1, 5));
          const message = error instanceof Error ? error.message : `${market === "GOLD" ? "黄金" : "外汇"}任务网络请求失败`;
          setNotice(`${message}，${Math.ceil(retryDelayMs / 1_000)} 秒后自动重试（第 ${failures} 次）`);
        }
        await new Promise((resolve) => window.setTimeout(resolve, retryDelayMs));
      }
    } finally {
      fxTaskLoopRef.current = null;
      await loadFxTask();
    }
  }, [loadFxTask, market, marketDataGateway, notifyDataChanged, setNotice]);

  useEffect(() => {
    if ((market !== "FX" && market !== "GOLD") || !fxTask || !["queued", "running"].includes(fxTask.status)) return;
    if (fxTaskLoopRef.current !== fxTask.id) void runFxTask(fxTask.id);
  }, [fxTask, market, runFxTask]);

  const handleFxAction = async (action: FxDataControlAction) => {
    const data = await marketDataGateway.fxDataAction<{ task?: FxDataTask | null; error?: string }>(action);
    if (!data.task) throw new Error(data.error ?? "行情任务操作失败");
    setFxTask(data.task);
    setFxQuality(data.task.quality ?? null);
    if (action.type !== "task" || action.action === "resume" || action.action === "retry") void runFxTask(data.task.id);
  };

  const updateJob = async (job: DownloadJob, action: "pause" | "resume" | "retry") => {
    if (job.syncRunId) {
      setNotice("美股批量任务请使用市场同步面板操作");
      return;
    }
    await marketDataGateway.updateJob(job.id, action);
    await loadJobs();
    if (action !== "pause") void runJob(job.id);
  };

  const deleteJob = async (job: DownloadJob) => {
    if (job.syncRunId) {
      setNotice("美股批量任务不支持单独删除");
      return;
    }
    if (!window.confirm("只删除这条下载任务记录？已经导入的 K 线会保留。")) return;
    await marketDataGateway.deleteJob(job.id);
    await loadJobs();
  };

  if (effectiveSetupView === "welcome") {
    return (
      <section className="data-onboarding">
        <div className="onboarding-hero">
          <div>
            <span className="section-label">首次数据初始化</span>
            <h2>建立你的本地历史行情库</h2>
            <p>行情、训练和数据版本都保存在这台电脑。先选一种初始化方式，之后仍可随时调整。</p>
          </div>
          <div className="onboarding-storage">
            <HardDrive size={18} />
            <span><strong>约 520 MB 下载</strong><small>预计占用 1～3 GB · 支持断点续传</small></span>
          </div>
        </div>

        <div className="onboarding-paths">
          <article className="onboarding-path recommended">
            <div className="path-badge"><Sparkles size={13} />推荐</div>
            <div className="path-icon"><CloudDownload size={25} /></div>
            <span>QUICK START</span>
            <h3>快速初始化</h3>
            <p>安装 BaoStock Python 包即可一次建立沪深京 A 股前复权历史日线库，无需 Token 或通达信客户端。</p>
            <ul>
              <li><CircleCheck size={14} />A 股与主要指数，包含退市股票</li>
              <li><CircleCheck size={14} />自动识别证券类型，中文名按本地目录匹配</li>
              <li><CircleCheck size={14} />由日线生成周线，训练统一使用前复权</li>
              <li><CircleCheck size={14} />低占用锁定训练数据版本</li>
            </ul>
            <button className="primary-button" onClick={() => setSetupView("quick")}>
              查看推荐方案<ChevronRight size={16} />
            </button>
          </article>

          <article className="onboarding-path">
            <div className="path-icon"><SlidersHorizontal size={25} /></div>
            <span>ADVANCED</span>
            <h3>高级自定义</h3>
            <p>自行选择市场、品种、最小周期、历史范围以及每一类数据的来源。</p>
            <ul>
              <li><CircleCheck size={14} />BaoStock 前复权日线与增量更新（默认）</li>
              <li><CircleCheck size={14} />保留 TDX/Tushare 不复权方案与 TdxQuant 可复权端点</li>
              <li><CircleCheck size={14} />日线自动生成周线与月线</li>
              <li><CircleCheck size={14} />Alpaca 美股历史行情</li>
              <li><CircleCheck size={14} />本机 BaoStock Python 依赖与本地数据服务</li>
            </ul>
            <button className="ghost-button" onClick={() => {
              setAdvancedStep(1);
              setSetupView("advanced");
            }}>
              开始自定义<ChevronRight size={16} />
            </button>
          </article>
        </div>

        <button className="onboarding-skip" onClick={() => saveSetupPlan(
          { kind: "existing", createdAt: new Date().toISOString() },
          "已进入现有数据管理；初始化向导可随时重新打开。",
        )}>
          已有数据，直接进入数据管理
        </button>
      </section>
    );
  }

  if (effectiveSetupView === "quick") {
    return (
      <section className="data-onboarding setup-detail">
        <button className="setup-back" onClick={() => setSetupView("welcome")}><ArrowLeft size={15} />返回</button>
        <div className="setup-detail-head">
          <div>
            <span className="section-label">推荐初始化方案</span>
            <h2>A 股全历史日线训练库</h2>
            <p>这是最少配置、最适合第一次使用的方案；分钟数据和美股可以以后补充。</p>
          </div>
          <div className="setup-ready"><ShieldCheck size={20} /><span><strong>BaoStock 内置数据源</strong><small>直接返回前复权价格；只需安装本机 Python 包</small></span></div>
        </div>

        <div className="quick-plan-grid">
          <div><span>市场与品种</span><strong>沪深京 A 股＋交易所指数</strong><small>包含当前上市及已退市股票</small></div>
          <div><span>历史范围</span><strong>全部可用历史</strong><small>避免随机训练出现幸存者偏差</small></div>
          <div><span>基础周期</span><strong>日线</strong><small>导入后自动生成周线</small></div>
          <div><span>行情来源</span><strong>BaoStock 前复权日线</strong><small>直接使用 BaoStock 返回的前复权价格</small></div>
        </div>

        <div className="snapshot-explainer">
          <ShieldCheck size={20} />
          <div><strong>锁定训练数据版本</strong><p>第一次保存完整版本，后续更新只保存新增或修正的差异；不会为每场训练复制整套数据库，也不会常驻内存。</p></div>
          <span>推荐开启</span>
        </div>

        <div className="setup-pipeline">
          {["读取 BaoStock 品种目录", "拉取前复权日线", "校验行情数据", "写入本地日线库", "更新品种覆盖", "生成周线/月线", "建立版本清单"].map((item, index) => (
            <div key={item}><span>{index + 1}</span><strong>{item}</strong>{index < 6 && <ArrowRight size={14} />}</div>
          ))}
        </div>

        <div className="setup-actions">
          <button className="ghost-button" onClick={() => {
            setAdvanced(defaultAdvancedSetup);
            setAdvancedStep(1);
            setSetupView("advanced");
          }}><Settings2 size={15} />改用高级自定义</button>
          <button className="primary-button" onClick={() => {
            const saved = { ...quickPlan, createdAt: new Date().toISOString() };
            void startLocalInitialization(saved, {
              assets: ["stock", "index"],
              includeDelisted: true,
              historyRange: "all",
              keepRawPackage: false,
              source: "baostock",
              provider: "baostock",
              adjustmentType: "qfq",
            });
          }}><CloudDownload size={15} />开始快速初始化</button>
        </div>
      </section>
    );
  }

  if (effectiveSetupView === "advanced") {
    const assets = [
      advanced.stocks && "A股股票",
      advanced.indices && "交易所指数",
      advanced.funds && "场内基金",
      advanced.convertibleBonds && "可转债",
    ].filter(Boolean).join("、") || "尚未选择";
    const intradaySetup = advanced.minimumTimeframe !== "1d";
    return (
      <section className="data-onboarding setup-detail advanced-setup">
        <button className="setup-back" onClick={() => setSetupView("welcome")}><ArrowLeft size={15} />退出高级自定义</button>
        <div className="setup-detail-head">
          <div><span className="section-label">高级自定义</span><h2>建立数据初始化方案</h2><p>凭证只在“设置 → 数据源设置”中管理，这里仅选择每个来源负责什么数据。</p></div>
        </div>
        <SetupProgress step={advancedStep} />

        <div className="advanced-step-body">
          {advancedStep === 1 && (
            <>
              <div className="advanced-group">
                <div className="advanced-group-head"><strong>市场</strong><small>可以先完成 A 股，之后再追加美股。</small></div>
                <div className="choice-card-grid two">
                  <button className={advanced.cnMarket ? "selected" : ""} onClick={() => setAdvanced((value) => ({ ...value, cnMarket: !value.cnMarket }))}>
                    <span>{advanced.cnMarket && <Check size={14} />}</span><strong>A 股市场</strong><small>上海、深圳、北京</small>
                  </button>
                  <button className={advanced.usMarket ? "selected" : ""} onClick={() => setAdvanced((value) => ({ ...value, usMarket: !value.usMarket, usSource: !value.usMarket ? "alpaca" : "none" }))}>
                    <span>{advanced.usMarket && <Check size={14} />}</span><strong>美股市场</strong><small>使用 Alpaca 历史行情</small>
                  </button>
                </div>
              </div>
              {advanced.cnMarket && (
                <div className="advanced-group">
                  <div className="advanced-group-head"><strong>A 股品种</strong><small>BaoStock 按品种拉取，选择项决定初始化范围。</small></div>
                  <div className="choice-card-grid">
                    {([
                      ["stocks", "A股股票", "训练主库"],
                      ["indices", "交易所指数", "大盘与行业参照"],
                      ["funds", "场内基金", "ETF、LOF 等"],
                      ["convertibleBonds", "可转债", "沪深京可转债"],
                    ] as const).map(([key, label, hint]) => (
                      <button key={key} className={advanced[key] ? "selected" : ""} onClick={() => setAdvanced((value) => ({ ...value, [key]: !value[key] }))}>
                        <span>{advanced[key] && <Check size={14} />}</span><strong>{label}</strong><small>{hint}</small>
                      </button>
                    ))}
                  </div>
                  <label className="setup-check"><input type="checkbox" checked={advanced.includeDelisted} onChange={(event) => setAdvanced((value) => ({ ...value, includeDelisted: event.target.checked }))} /><span><strong>包含退市和暂停上市股票</strong><small>推荐开启，避免训练样本出现幸存者偏差。</small></span></label>
                </div>
              )}
            </>
          )}

          {advancedStep === 2 && (
            <>
              <div className="advanced-group">
                <div className="advanced-group-head"><strong>最小时间周期</strong><small>更大的周期由最小周期在本地聚合生成。</small></div>
                <div className="choice-card-grid three">
                  {TIMEFRAME_IDS.map((value) => {
                    const available = DIRECT_SETUP_TIMEFRAMES.has(value);
                    const hint = !available
                      ? "当前初始化方案不提供此直接周期"
                      : value === "1d"
                      ? "BaoStock 返回前复权日线；W1、MN 由本地生成"
                      : "TdxQuant 可提供分钟周期，并按端点选择复权口径";
                    return (
                      <button
                        key={value}
                        className={advanced.minimumTimeframe === value ? "selected" : ""}
                        disabled={!available}
                        onClick={() => setAdvanced((current) => ({
                          ...current,
                          minimumTimeframe: value,
                          cnInitialSource: value === "1d" ? current.cnInitialSource : "tdxquant",
                          cnIncrementalSource: value === "1d"
                            ? current.cnIncrementalSource
                            : current.cnIncrementalSource === "none" ? "none" : "tdxquant",
                        }))}
                      >
                        <span>{advanced.minimumTimeframe === value && <Check size={14} />}</span><strong>{catalogTimeframeLabel(value)}</strong><small>{hint}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="advanced-group">
                <div className="advanced-group-head"><strong>历史范围</strong><small>{intradaySetup ? `TdxQuant 按所选 ${catalogTimeframeLabel(advanced.minimumTimeframe)} 周期返回可复权行情。` : "BaoStock 会按所选范围请求前复权日线。"}</small></div>
                <div className="segmented-choice">
                  {([["all", "全部历史"], ["20y", "最近20年"], ["10y", "最近10年"]] as const).map(([value, label]) => (
                    <button key={value} className={advanced.historyRange === value ? "active" : ""} onClick={() => setAdvanced((current) => ({ ...current, historyRange: value }))}>{label}</button>
                  ))}
                </div>
              </div>
              <label className="setup-check"><input type="checkbox" checked={advanced.keepRawPackage} onChange={(event) => setAdvanced((value) => ({ ...value, keepRawPackage: event.target.checked }))} /><span><strong>导入后保留原始压缩包</strong><small>关闭可节省约 520 MB；数据版本复现不依赖原始 ZIP。</small></span></label>
            </>
          )}

          {advancedStep === 3 && (
            <div className="source-routing">
              {advanced.cnMarket && (
                <>
                  <label>{intradaySetup ? `首次 A 股完整${catalogTimeframeLabel(advanced.minimumTimeframe)}行情` : "首次 A 股完整日线"}
                    <select value={advanced.cnInitialSource} onChange={(event) => setAdvanced((value) => ({ ...value, cnInitialSource: event.target.value as AdvancedSetup["cnInitialSource"] }))}>
                      {intradaySetup ? (
                        <option value="tdxquant">TdxQuant {catalogTimeframeLabel(advanced.minimumTimeframe)}（可复权，需本机端点）</option>
                      ) : (
                        <>
                          <option value="baostock">BaoStock 前复权日线（默认）</option>
                          <option value="tdxquant">TdxQuant 前复权日线（需本机端点）</option>
                          <option value="tdx-zip">通达信官方日线完整包（不复权）</option>
                          <option value="tushare">Tushare 逐批下载（不复权）</option>
                        </>
                      )}
                    </select>
                  </label>
                  <label>{intradaySetup ? `${catalogTimeframeLabel(advanced.minimumTimeframe)} 增量更新` : "日线增量更新"}
                    <select value={advanced.cnIncrementalSource} onChange={(event) => setAdvanced((value) => ({ ...value, cnIncrementalSource: event.target.value as AdvancedSetup["cnIncrementalSource"] }))}>
                      {intradaySetup ? (
                        <option value="tdxquant">TdxQuant {catalogTimeframeLabel(advanced.minimumTimeframe)} 增量（可复权）</option>
                      ) : (
                        <>
                          <option value="baostock">BaoStock 前复权增量（默认）</option>
                          <option value="tushare">Tushare daily 增量（不复权）</option>
                          <option value="tdxquant">TdxQuant 增量（可复权）</option>
                        </>
                      )}
                      <option value="none">暂不设置增量</option>
                    </select>
                  </label>
                </>
              )}
              {advanced.usMarket && (
                <label>美股历史行情
                  <select value={advanced.usSource} onChange={(event) => setAdvanced((value) => ({ ...value, usSource: event.target.value as AdvancedSetup["usSource"] }))}>
                    <option value="alpaca">Alpaca Market Data</option>
                    <option value="none">暂不下载美股</option>
                  </select>
                </label>
              )}

              <div className="source-status-grid">
                <div className="ready"><CircleCheck size={16} /><span><strong>品种目录</strong><small>可用 · 无需 Token</small></span></div>
                {advanced.cnMarket && (intradaySetup ? (
                  <div className={configured.tdxquant ? "ready" : ""}><span className="status-dot" /><span><strong>TdxQuant</strong><small>{configured.tdxquant ? `${catalogTimeframeLabel(advanced.minimumTimeframe)} · 本机已配置 · 可复权` : `${catalogTimeframeLabel(advanced.minimumTimeframe)} · 需配置本机端点`}</small></span></div>
                ) : (
                  <>
                    <div className="ready"><CircleCheck size={16} /><span><strong>BaoStock</strong><small>默认 · 直接返回前复权</small></span></div>
                    <div className="ready"><CircleCheck size={16} /><span><strong>通达信 / Tushare</strong><small>旧方案保留 · 日线不复权</small></span></div>
                    <div className={configured.tdxquant ? "ready" : ""}><span className="status-dot" /><span><strong>TdxQuant</strong><small>{configured.tdxquant ? "本机已配置 · 日线可复权" : "可配置 · 支持日线复权"}</small></span></div>
                  </>
                ))}
                {advanced.usMarket && <div className={configured.alpaca ? "ready" : ""}><span className="status-dot" /><span><strong>Alpaca</strong><small>{configured.alpaca ? "本机已配置 · 支持当前周期" : "尚未配置 · 支持当前周期"}</small></span></div>}
              </div>

              <button className="ghost-button source-settings-link" onClick={onOpenSettings}><Settings2 size={15} />前往数据源设置</button>
            </div>
          )}

          {advancedStep === 4 && (
            <>
              <div className="plan-review">
                <div><span>市场</span><strong>{[advanced.cnMarket && "沪深京", advanced.usMarket && "美股"].filter(Boolean).join("＋") || "尚未选择"}</strong></div>
                <div><span>品种</span><strong>{advanced.cnMarket ? assets : "美股股票"}</strong></div>
                <div><span>最小周期</span><strong>{timeframeLabel(advanced.minimumTimeframe)}</strong></div>
                <div><span>历史范围</span><strong>{{ all: "全部历史", "20y": "最近20年", "10y": "最近10年" }[advanced.historyRange]}</strong></div>
                <div><span>A股数据来源</span><strong>{!advanced.cnMarket ? "不下载 A 股" : advanced.cnInitialSource === "baostock" ? "BaoStock 前复权日线" : advanced.cnInitialSource === "tdxquant" ? (advanced.minimumTimeframe === "1d" ? "TdxQuant 前复权日线（本机端点）" : `TdxQuant ${catalogTimeframeLabel(advanced.minimumTimeframe)}（可复权，本机端点）`) : advanced.cnInitialSource === "tushare" ? "Tushare daily（不复权）" : "通达信日线包（不复权）"}</strong></div>
                <div><span>复权口径</span><strong>{!advanced.cnMarket ? "—" : advanced.cnInitialSource === "baostock" || advanced.cnInitialSource === "tdxquant" ? (advanced.usMarket ? "A 股前复权 · 美股全复权" : "A 股前复权") : advanced.cnInitialSource === "tushare" || advanced.cnInitialSource === "tdx-zip" ? "A 股不复权" : "A 股按所选端点"}</strong></div>
                <div><span>增量方案</span><strong>{!advanced.cnMarket ? "—" : advanced.cnIncrementalSource === "baostock" ? "BaoStock 前复权" : advanced.cnIncrementalSource === "tdxquant" ? `TdxQuant ${intradaySetup ? catalogTimeframeLabel(advanced.minimumTimeframe) : "日线"} 可复权` : advanced.cnIncrementalSource === "tushare" ? "Tushare 不复权" : "不设置"}</strong></div>
                <div><span>版本锁定</span><strong>开启 · 仅保存差异和被引用版本</strong></div>
              </div>
              {advanced.usMarket && advanced.usSource === "alpaca" && !configured.alpaca && (
                <div className="setup-warning">美股已选择 Alpaca，但尚未配置 API Key。可以先完成 A 股初始化。</div>
              )}
              {advanced.cnMarket && advanced.cnInitialSource === "baostock" && (
                <div className="setup-warning">首次使用前请安装 BaoStock Python 包；BaoStock 初始化直接写入前复权价格。</div>
              )}
              {advanced.cnMarket && advanced.cnInitialSource === "tdxquant" && (
                <div className="setup-warning">{intradaySetup ? `TdxQuant ${catalogTimeframeLabel(advanced.minimumTimeframe)} 通过本机端点返回可复权行情；请先在“数据源设置”配置端点并启动支持 TQ 的通达信客户端。当前本地全历史初始化任务尚未接入 TdxQuant。` : "TdxQuant 日线通过本机端点返回前复权价格；请先在“数据源设置”配置端点并启动支持 TQ 的通达信客户端。当前本地全历史初始化任务会保留该方案，实际建库仍需选择 BaoStock 或通达信完整包。"}</div>
              )}
              {advanced.cnMarket && ["tdx-zip", "tushare"].includes(advanced.cnInitialSource) && (
                <div className="setup-warning">当前选择的是旧方案，日线明确标记为不复权；后续如需前复权，请切换 BaoStock，或使用已配置的 TdxQuant 复权端点。</div>
              )}
            </>
          )}
        </div>

        <div className="setup-actions">
          <button className="ghost-button" disabled={advancedStep === 1} onClick={() => setAdvancedStep((value) => Math.max(1, value - 1))}><ArrowLeft size={15} />上一步</button>
          {advancedStep < 4 ? (
            <button className="primary-button" disabled={advancedStep === 1 && !advanced.cnMarket && !advanced.usMarket} onClick={() => setAdvancedStep((value) => Math.min(4, value + 1))}>下一步<ArrowRight size={15} /></button>
          ) : (
            <button className="primary-button" onClick={() => {
              const saved = { kind: "advanced", ...advanced, createdAt: new Date().toISOString() };
              if (advanced.cnMarket && advanced.minimumTimeframe === "1d" && ["baostock", "tdx-zip"].includes(advanced.cnInitialSource)) {
                const selectedAssets = [
                  advanced.stocks && "stock",
                  advanced.indices && "index",
                  advanced.funds && "fund",
                  advanced.convertibleBonds && "convertible-bond",
                ].filter(Boolean);
                void startLocalInitialization(saved, {
                  assets: selectedAssets,
                  includeDelisted: advanced.includeDelisted,
                  historyRange: advanced.historyRange,
                  keepRawPackage: advanced.keepRawPackage,
                  source: advanced.cnInitialSource,
                  provider: advanced.cnInitialSource === "baostock" ? "baostock" : "tdx",
                  adjustmentType: advanced.cnInitialSource === "baostock" ? "qfq" : "none",
                  cnIncrementalSource: advanced.cnIncrementalSource,
                });
              } else if (advanced.cnMarket) {
                const message = advanced.cnInitialSource === "tdxquant"
                  ? `已保留 TdxQuant ${advanced.minimumTimeframe === "1d" ? "前复权日线" : `${catalogTimeframeLabel(advanced.minimumTimeframe)} 可复权`}方案；请在数据源设置中配置本机端点。当前本地全历史初始化任务尚未接入 TdxQuant。`
                  : "已保留该自定义方案。Tushare 逐批接口和 TdxQuant 可复权端点可在任务区/数据源设置中继续使用。";
                saveSetupPlan(
                  saved,
                  message,
                );
              } else {
                saveSetupPlan(
                  saved,
                  "高级初始化方案已保存。所选外部数据源可在下方创建下载任务。",
                );
              }
            }}><Check size={15} />保存并开始初始化</button>
          )}
        </div>
      </section>
    );
  }

  const marketCopy = {
    CN: {
      label: "A股",
      title: "A 股数据维护",
      description: "完整库由 BaoStock 建立并直接返回前复权日线；之后按市场拉取最新版本，无需逐个输入证券代码。",
    },
    US: {
      label: "美股",
      title: "美股数据维护",
      description: "使用 Alpaca SIP/IEX 行情批量初始化活跃可交易美股，之后从每个品种最后日期继续更新。",
    },
    FX: {
      label: "外汇",
      title: "外汇数据维护",
      description: "外汇数据独立存放和管理，不与股票代码、任务或覆盖明细混排。",
    },
    GOLD: {
      label: "黄金",
      title: "黄金数据维护",
      description: "黄金与贵金属使用独立数据集，后续可接入专门的历史行情源。",
    },
  }[market];
  const localSourceValue = localTask?.plan?.source ?? localDataset?.source ?? "";
  const localUsesBaoStock = !localSourceValue || localSourceValue.toLowerCase().includes("baostock");
  const localAdjustmentReady = localDataset?.adjustmentStatus === "ready" || localDataset?.adjustmentStatus === "not-adjusted";
  const localSourceTitle = localUsesBaoStock ? "BaoStock A 股全市场前复权日线库" : "通达信 A 股全市场日线库（不复权）";

  return (
    <section className="data-source-manager">
      <div className="data-source-head">
        <div>
          <span className="section-label">{marketCopy.label} · 真实历史行情</span>
          <h2>{marketCopy.title}</h2>
          <p>{marketCopy.description}</p>
        </div>
        <div className="data-source-head-actions">
          {market === "CN" && <button type="button" className="ghost-button" onClick={() => {
            setSetupOpenedByUser(true);
            setSetupView("welcome");
          }}><SlidersHorizontal size={15} />初始化设置</button>}
          <CloudDownload size={24} />
        </div>
      </div>

      {market === "CN" && savedPlan && (
        <div className="saved-data-plan">
          <FileArchive size={19} />
          <span>
            <strong>{savedPlan.kind === "quick" ? "推荐初始化方案" : savedPlan.kind === "advanced" ? "高级初始化方案" : "现有数据库模式"}</strong>
            <small>{savedPlan.kind === "quick" ? "沪深京 A 股全历史日线＋自动周线" : savedPlan.kind === "advanced" ? "已按自定义市场、周期和来源保存" : "保留并管理当前已有行情"}</small>
          </span>
          <button type="button" onClick={() => {
            setSetupOpenedByUser(true);
            setSetupView(savedPlan.kind === "quick" ? "quick" : "advanced");
          }}>查看或修改</button>
        </div>
      )}

      {market === "CN" && (
        <div className={`local-initialization-card ${localTask?.status ?? "idle"}`}>
          <div className="local-task-icon"><FileArchive size={20} /></div>
          <div className="local-task-copy">
            <span>{localSourceTitle}</span>
            <strong>{localTask
              ? {
                  queued: "等待开始",
                  running: localTask.stage === "cataloging"
                    ? `正在读取 ${localUsesBaoStock ? "BaoStock" : "通达信"} 品种目录`
                    : localUsesBaoStock ? "正在拉取 BaoStock 前复权日线" : "正在导入通达信日线（不复权）",
                  paused: "已暂停",
                  completed: localAdjustmentReady ? "初始化完成，可拉取更新" : "需要处理",
                  failed: "需要处理",
                }[localTask.status]
              : localServiceAvailable ? "尚未初始化" : "本机数据服务未启动"}</strong>
            <small>{localTask?.error || localTask?.message || (localServiceAvailable
              ? localUsesBaoStock
                ? "从初始化设置开始，一次建立 BaoStock 全市场前复权日线，并在本地生成周线和月线。"
                : "从初始化设置开始，导入原有通达信日线包；该方案明确保持不复权。"
              : localServiceError || "请关闭当前窗口后重新启动本地控制面板。")}</small>
            {catalogTask && <small className="catalog-task-status">
              中文名称：{catalogTask.error || catalogTask.message}
            </small>}
            {localTask && (
              <div className="local-task-progress">
                <i style={{ width: `${localTask.status === "completed"
                  ? 100
                  : localTask.progress.totalFiles
                    ? localTask.progress.processedFiles / localTask.progress.totalFiles * 100
                    : localTask.stage === "cataloging" ? 2 : 0}%` }} />
              </div>
            )}
          </div>
          {localTask && (
            <div className="local-task-metrics">
              <span><strong>{localTask.progress.processedFiles.toLocaleString()} / {Number(localTask.progress.totalFiles ?? 0).toLocaleString()}</strong><small>已处理品种</small></span>
              <span><strong>{localTask.progress.indexedInstruments.toLocaleString()}</strong><small>已写入品种</small></span>
            </div>
          )}
          <div className="local-task-actions">
            {localTask?.status === "completed" && localAdjustmentReady && <button disabled={catalogTask?.status === "running"} onClick={() => void refreshCnMarket()}><CloudDownload size={14} />{localUsesBaoStock ? "刷新 BaoStock 全量数据" : "刷新通达信全量数据"}</button>}
            {localTask?.status === "completed" && catalogTask?.status !== "running" && <button onClick={() => void refreshCatalog()}><RefreshCw size={14} />更新中文名称</button>}
            {localTask?.status === "running" && <button onClick={() => void updateLocalTask("pause")}><Pause size={14} />暂停</button>}
            {(localTask?.status === "paused" || localTask?.status === "failed") && <button onClick={() => void updateLocalTask("resume")}><Play size={14} />继续</button>}
            {localTask && !["running", "queued"].includes(localTask.status) && <button className="danger" onClick={() => void removeLocalTaskRecord()}><Trash2 size={14} />移除任务记录</button>}
          </div>
        </div>
      )}

      {market === "CN" && localTask?.status === "completed" && localAdjustmentReady && (
        <div className={`market-maintenance-card ${localServiceAvailable ? "ready" : ""} ${cnMaintenanceTask?.status === "failed" ? "failed" : ""}`}>
          <div className="market-maintenance-icon"><Database size={22} /></div>
          <div>
            <span>{localUsesBaoStock ? "BAOSTOCK · A 股前复权日线维护" : "TDX / TUSHARE · A 股不复权日线维护"}</span>
            <strong>{cnMaintenanceTask
              ? {
                  queued: "等待开始",
                  running: cnMaintenanceTask.mode === "repair" ? "正在扫描并修复缺口" : "正在拉取每日增量",
                  paused: "维护任务已暂停",
                  completed: cnMaintenanceTask.mode === "repair" ? "缺口回查已完成" : "每日增量已完成",
                  failed: "维护任务需要处理",
                }[cnMaintenanceTask.status]
              : localServiceAvailable ? "可以进行每日增量和缺口修复" : `本机 ${localUsesBaoStock ? "BaoStock" : "TDX"} 服务不可用`}</strong>
            <small>{cnMaintenanceTask?.error || cnMaintenanceTask?.message || (localServiceAvailable
              ? localUsesBaoStock
                ? "按品种使用 BaoStock 拉取前复权日线；周线和月线继续由本地日线生成。"
                : "旧方案使用 Tushare daily 做日线维护，价格保持不复权；请先配置 Tushare Token。"
              : localServiceError || "请安装 BaoStock Python 包并重启本地数据服务。")}</small>
            {cnMaintenanceTask && (
              <>
                <div className="local-task-progress">
                  <i style={{ width: `${cnMaintenanceTask.progress.totalDates
                    ? cnMaintenanceTask.progress.processedDates / cnMaintenanceTask.progress.totalDates * 100
                    : cnMaintenanceTask.status === "completed" ? 100 : 0}%` }} />
                </div>
                <small className="maintenance-task-summary">
                  日期 {cnMaintenanceTask.progress.processedDates.toLocaleString()} / {cnMaintenanceTask.progress.totalDates.toLocaleString()}
                  {" · "}新增 {cnMaintenanceTask.progress.insertedBars.toLocaleString()}
                  {" · "}校正 {cnMaintenanceTask.progress.correctedBars.toLocaleString()}
                  {" · "}未变化 {cnMaintenanceTask.progress.unchangedBars.toLocaleString()}
                  {" · "}来源 {localUsesBaoStock ? "BaoStock 前复权" : "Tushare 不复权"}
                </small>
              </>
            )}
          </div>
          <div className="market-maintenance-actions">
            {localServiceAvailable && !["queued", "running", "paused", "failed"].includes(cnMaintenanceTask?.status ?? "") && (
              <>
                <button className="primary" disabled={maintenanceBusy} onClick={() => void updateCnMaintenance("start", "incremental")}>
                  <CloudDownload size={14} />每日增量更新
                </button>
                <button disabled={maintenanceBusy} onClick={() => void updateCnMaintenance("start", "repair")}>
                  <RefreshCw size={14} />扫描并修复缺口
                </button>
              </>
            )}
            {localServiceAvailable && ["queued", "running"].includes(cnMaintenanceTask?.status ?? "") && (
              <button className="danger" disabled={maintenanceBusy} onClick={() => void updateCnMaintenance("pause")}>
                <Pause size={14} />暂停维护
              </button>
            )}
            {localServiceAvailable && ["paused", "failed"].includes(cnMaintenanceTask?.status ?? "") && (
              <button className="primary" disabled={maintenanceBusy} onClick={() => void updateCnMaintenance("resume", cnMaintenanceTask?.mode ?? "incremental")}>
                <Play size={14} />继续维护
              </button>
            )}
          </div>
        </div>
      )}

      {market === "US" && (
        <div className={`market-maintenance-card ${configured.alpaca ? "ready" : ""} ${usNeedsRebuild ? "needs-rebuild" : ""}`}>
          <div className="market-maintenance-icon"><Database size={22} /></div>
          <div>
            <span>ALPACA · SIP/IEX 历史行情</span>
            <strong>{usNeedsRebuild
              ? "发现旧版未复权数据，需重建全复权历史"
              : usInitialized
              ? "美股市场库已建立"
              : usStarted ? `初始化未完成：还剩 ${usRemaining.toLocaleString()} 个品种` : "美股市场库尚未初始化"}</strong>
            <small>{usNeedsRebuild
              ? `原有 ${legacyUsData?.instrumentCount.toLocaleString() ?? "部分"} 个品种、约 ${legacyUsData?.barCount.toLocaleString() ?? "—"} 根未复权 K 线仍保留，但已停止用于训练；点击重建后才会恢复全复权历史。`
              : usInitialized
              ? "点击更新后，系统会检查已初始化的全部美股并从最后日期继续，不需要输入代码。"
              : marketSync
                ? `当前批量任务：${marketSync.run.completedSymbols.toLocaleString()} / ${marketSync.run.totalSymbols.toLocaleString()} 个品种，${marketSync.run.completedBatches.toLocaleString()} / ${marketSync.run.totalBatches.toLocaleString()} 批，数据源 ${marketSync.run.feed.toUpperCase()}。`
                : usStarted
                  ? `已完成 ${jobSummary.completed.toLocaleString()} / ${jobSummary.total.toLocaleString()} 个任务；继续时优先处理未完成任务，不会重下已有 K 线。`
                  : "首次初始化会自动读取活跃可交易美股目录，并建立从 2016 年至今的可恢复批量任务；服务端按交易日数量和 URL 长度自动计算批次。"}</small>
          </div>
          <div className="market-maintenance-actions">
            {!configured.alpaca && <button onClick={onOpenSettings}><Settings2 size={14} />配置 Alpaca</button>}
            {configured.alpaca && !marketSyncBusy && !["queued", "running", "paused"].includes(marketSync?.run.status ?? "") && (
              <button className="primary" onClick={() => void syncUsMarket(usNeedsRebuild ? "initialize" : chooseUsSyncMode({ started: usStarted, remaining: usRemaining }))}>
                <CloudDownload size={14} />{usNeedsRebuild
                  ? "重建美股全复权数据"
                  : usInitialized
                  ? "拉取最新美股数据"
                  : usStarted ? "继续初始化美股" : "初始化美股市场库"}
              </button>
            )}
            {marketSync?.run.status === "running" && <button className="danger" disabled={marketSyncBusy} onClick={() => void controlUsMarketSync("pause")}>
              <Pause size={14} />暂停同步
            </button>}
            {marketSync?.run.status === "paused" && <button className="primary" disabled={marketSyncBusy} onClick={() => void controlUsMarketSync("resume")}>
              <Play size={14} />继续同步
            </button>}
            {marketSync?.run.status === "completed_with_errors" && <button className="primary" disabled={marketSyncBusy} onClick={() => void controlUsMarketSync("retry")}>
              <RefreshCw size={14} />重试失败批次
            </button>}
          </div>
        </div>
      )}

      {(market === "FX" || market === "GOLD") && (
        <FxDataControlPanel
          apiPaths={{ initialize: "/api/fx-data/initialize", update: "/api/fx-data/update", task: "/api/fx-data/task" }}
          currentTask={fxTask}
          qualitySummary={fxQuality}
          currencyPairs={market === "GOLD" ? DEFAULT_GOLD_INSTRUMENTS : DEFAULT_FX_CURRENCY_PAIRS}
          defaultStartDate="2020-01-01"
          defaultEndDate={new Date().toISOString().slice(0, 10)}
          datasetLabel={market === "GOLD" ? "黄金" : "外汇"}
          instrumentNoun={market === "GOLD" ? "品种" : "货币对"}
          onAction={handleFxAction}
          onRefreshStatus={async () => { await loadFxTask(); }}
        />
      )}

      <div className="storage-policy-card">
        <ShieldCheck size={18} />
        <span><strong>{marketCopy.label}训练数据版本已锁定</strong><small>相同数据只保存一次；行情更新后只增加变化内容，不会为每场训练复制整套数据库。</small></span>
        <i>低占用</i>
      </div>

      {notice && <div className="status-banner">{notice}</div>}

      {(market === "CN" || market === "US") && (
        <div className="download-job-list">
          <div className="download-job-header"><span>任务</span><span>范围</span><span>进度 / 质量</span><span>状态</span><span>操作</span></div>
          {marketJobs.length ? marketJobs.map((job) => {
            let quality: { invalid?: number; duplicates?: number } = {};
            try {
              quality = JSON.parse(job.qualityReportJson || "{}") as typeof quality;
            } catch {
              quality = {};
            }
            return (
              <div className="download-job-row" key={job.id}>
                <span><strong>{job.instrumentId} · {catalogTimeframeLabel(job.timeframe)}</strong><small>{job.provider} / {job.vendorSymbol}</small></span>
                <span><strong>{job.startDate} — {job.endDate}</strong><small>{job.instrumentName}</small></span>
                <span>
                  <strong>{job.status === "completed" && Number(job.insertedCount) === 0
                    ? "无新增 K 线"
                    : `${Number(job.insertedCount).toLocaleString()} 根`}</strong>
                  <small>{job.status === "completed" && Number(job.insertedCount) === 0
                    ? "休市、当前账户无对应行情或已经是最新"
                    : `无效 ${quality.invalid ?? 0} · 重复 ${quality.duplicates ?? 0}`}</small>
                </span>
                <span><i className={`job-status ${job.status}`} />{statusLabel(job.status)}{job.lastError && <small title={job.lastError}>{job.lastError}</small>}</span>
                <span className="download-job-actions">
                  {(job.status === "queued" || job.status === "running") && <button title="暂停" onClick={() => updateJob(job, "pause")}><Pause size={14} /></button>}
                  {job.status === "paused" && <button title="继续" onClick={() => updateJob(job, "resume")}><Play size={14} /></button>}
                  {job.status === "failed" && <button title="重试" onClick={() => updateJob(job, "retry")}><RefreshCw size={14} /></button>}
                  {job.status === "completed" && <button title="重新读取列表" onClick={loadJobs}><RefreshCw size={14} /></button>}
                  <button title="删除任务记录" onClick={() => deleteJob(job)}><Trash2 size={14} /></button>
                </span>
              </div>
            );
          }) : <div className="download-empty"><Database size={18} />{marketCopy.label}还没有独立下载任务。</div>}
        </div>
      )}
    </section>
  );
}
