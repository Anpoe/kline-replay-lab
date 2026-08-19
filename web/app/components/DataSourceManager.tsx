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
  FxDataControlPanel,
  type FxDataControlAction,
  type FxDataTask,
  type FxQualitySummary,
} from "./FxDataControlPanel";

type DownloadProviderId = "tushare" | "alpaca";
type ProviderId = DownloadProviderId | "tdxquant" | "twelvedata" | "dukascopy";
type DataMarket = "CN" | "US" | "FX" | "GOLD";
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
  stage: "waiting" | "downloading" | "verifying" | "extracting" | "weekly-ready" | "completed";
  message: string;
  error?: string | null;
  progress: {
    downloadedBytes: number;
    totalBytes: number;
    processedFiles: number;
    totalFiles: number;
    indexedInstruments: number;
  };
  plan?: {
    assets?: string[];
    includeDelisted?: boolean;
    historyRange?: "all" | "20y" | "10y";
    keepRawPackage?: boolean;
  };
  updatedAt: string;
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
  minimumTimeframe: "1d" | "1h" | "5m";
  historyRange: "all" | "20y" | "10y";
  cnInitialSource: "tdx-zip" | "local-zip" | "tushare";
  cnIncrementalSource: "none" | "tushare" | "tdxquant";
  intradaySource: "none" | "tdxquant";
  usSource: "none" | "alpaca";
  keepRawPackage: boolean;
};

const onboardingKey = "kline-training:data-onboarding";
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
  cnInitialSource: "tdx-zip",
  cnIncrementalSource: "none",
  intradaySource: "none",
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
  source: "通达信官方日线完整包",
  catalog: "内置品种目录＋免 Token 更新",
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
  if (value === "5m") return "5 分钟（自动生成 1 小时、日线、周线）";
  if (value === "1h") return "1 小时（自动生成日线、周线）";
  return "日线（自动生成周线）";
}

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
  const [marketSyncBusy, setMarketSyncBusy] = useState(false);
  const [setupView, setSetupView] = useState<SetupView>(market === "CN" ? "welcome" : "manager");
  const effectiveSetupView: SetupView = market !== "CN" || hasData ? "manager" : setupView;
  const [advancedStep, setAdvancedStep] = useState(1);
  const [advanced, setAdvanced] = useState<AdvancedSetup>(defaultAdvancedSetup);
  const [savedPlan, setSavedPlan] = useState<Record<string, unknown> | null>(null);
  const [localTask, setLocalTask] = useState<LocalDataTask | null>(null);
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
    const response = await fetch("/api/data-providers");
    if (!response.ok) return;
    const data = await response.json() as { providers: Provider[] };
    setProviders(data.providers);
  }, []);

  const loadJobs = useCallback(async () => {
    const requestMarket = market;
    const response = await fetch(`/api/data-jobs?market=${requestMarket}`);
    if (!response.ok) return;
    const data = await response.json() as {
      jobs: DownloadJob[];
      summary?: Partial<DownloadJobSummary>;
    };
    if (activeMarketRef.current !== requestMarket) return;
    setJobs(data.jobs);
    setJobSummary({
      total: Number(data.summary?.total ?? 0),
      queued: Number(data.summary?.queued ?? 0),
      running: Number(data.summary?.running ?? 0),
      paused: Number(data.summary?.paused ?? 0),
      completed: Number(data.summary?.completed ?? 0),
      failed: Number(data.summary?.failed ?? 0),
      insertedCount: Number(data.summary?.insertedCount ?? 0),
    });
  }, [market]);

  const loadMarketSync = useCallback(async (runId?: string) => {
    if (market !== "US") return null;
    const requestMarket = market;
    const query = runId ? "?runId=" + encodeURIComponent(runId) : "";
    const response = await fetch("/api/data-jobs/market/sync" + query, { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json() as {
      run?: MarketSyncStatus["run"] | null;
      currentBatch?: MarketSyncStatus["currentBatch"];
      pendingBatches?: number;
      runningBatches?: number;
      failedBatches?: number;
    };
    if (activeMarketRef.current !== requestMarket) return null;
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
  }, [market]);

  const loadLocalTask = useCallback(async () => {
    try {
      const response = await fetch("/api/local-data");
      const data = await response.json() as {
        available?: boolean;
        task?: LocalDataTask | null;
      };
      const available = Boolean(data.available);
      const recovered = !localServiceAvailableRef.current && available;
      localServiceAvailableRef.current = available;
      setLocalServiceAvailable(available);
      setLocalTask(data.task ?? null);
      return { available, recovered };
    } catch {
      localServiceAvailableRef.current = false;
      setLocalServiceAvailable(false);
      return { available: false, recovered: false };
    }
  }, []);

  const loadCatalogTask = useCallback(async () => {
    try {
      const response = await fetch("/api/local-data?action=catalog-status");
      if (!response.ok) return null;
      const data = await response.json() as { catalogTask?: CatalogTask | null };
      const task = data.catalogTask ?? null;
      setCatalogTask(task);
      return task;
    } catch {
      // 本机数据服务不可用时由主状态卡统一提示。
      return null;
    }
  }, []);

  const loadCnMaintenanceTask = useCallback(async () => {
    try {
      const response = await fetch("/api/cn-maintenance");
      if (!response.ok) return null;
      const data = await response.json() as { maintenanceTask?: CnMaintenanceTask | null };
      const task = data.maintenanceTask ?? null;
      setCnMaintenanceTask(task);
      return task;
    } catch {
      return null;
    }
  }, []);

  const loadFxTask = useCallback(async () => {
    if (market !== "FX") return null;
    try {
      const response = await fetch("/api/fx-data", { cache: "no-store" });
      if (!response.ok) return null;
      const data = await response.json() as { task?: FxDataTask | null; qualitySummary?: FxQualitySummary | null };
      const task = data.task ?? null;
      setFxTask(task);
      setFxQuality(data.qualitySummary ?? task?.quality ?? null);
      return task;
    } catch {
      return null;
    }
  }, [market]);

  useEffect(() => {
    aliveRef.current = true;
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem(onboardingKey);
      if (stored) {
        try {
          setSavedPlan(JSON.parse(stored) as Record<string, unknown>);
          setSetupView("manager");
        } catch {
          window.localStorage.removeItem(onboardingKey);
        }
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
  }, [loadCatalogTask, loadCnMaintenanceTask, loadFxTask, loadJobs, loadLocalTask, loadMarketSync, loadProviders]);

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

  useEffect(() => {
    const reload = () => {
      void Promise.all([
        loadJobs(),
        loadMarketSync(),
        loadLocalTask(),
        loadCnMaintenanceTask(),
        loadFxTask(),
      ]);
    };
    window.addEventListener("data-auto-update-updated", reload);
    return () => window.removeEventListener("data-auto-update-updated", reload);
  }, [loadCnMaintenanceTask, loadFxTask, loadJobs, loadLocalTask, loadMarketSync]);

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
  const usInitialized = market === "US"
    && ((marketSync?.run.status === "completed" && marketSync.run.failedSymbols === 0)
      || (!marketSync && usStarted && usRemaining === 0));

  const saveSetupPlan = (plan: Record<string, unknown>, message: string) => {
    window.localStorage.setItem(onboardingKey, JSON.stringify(plan));
    setSavedPlan(plan);
    setNotice(message);
    setSetupView("manager");
  };

  const startLocalInitialization = async (
    saved: Record<string, unknown>,
    plan: Record<string, unknown>,
  ) => {
    setNotice("正在连接本机数据服务并创建可恢复初始化任务……");
    try {
      const response = await fetch("/api/local-data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", plan }),
      });
      const result = await response.json() as { task?: LocalDataTask; error?: string };
      if (!response.ok || !result.task) throw new Error(result.error ?? "初始化任务创建失败");
      window.localStorage.setItem(onboardingKey, JSON.stringify(saved));
      setSavedPlan(saved);
      setLocalTask(result.task);
      setLocalServiceAvailable(true);
      setNotice("初始化任务已开始。关闭网页不会丢失进度；再次打开后可以继续查看。");
      setSetupView("manager");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法启动本机初始化任务");
    }
  };

  const updateLocalTask = async (action: "pause" | "resume") => {
    const response = await fetch("/api/local-data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const result = await response.json() as { task?: LocalDataTask; error?: string };
    if (!response.ok) {
      setNotice(result.error ?? "任务操作失败");
      return;
    }
    setLocalTask(result.task ?? null);
    setNotice(action === "pause" ? "任务已请求暂停，当前进度会保留。" : "任务已继续。");
  };

  const removeLocalTaskRecord = async () => {
    if (!window.confirm("移除这条初始化任务记录？已经导入的行情文件会保留。")) return;
    const response = await fetch("/api/local-data", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ removeData: false }),
    });
    if (response.ok) setLocalTask(null);
  };

  const refreshCatalog = async () => {
    setNotice("正在启动中文名称目录更新；期间仍可继续使用训练功能。");
    const response = await fetch("/api/local-data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "catalog-refresh" }),
    });
    const result = await response.json() as { catalogTask?: CatalogTask; error?: string };
    if (!response.ok || !result.catalogTask) {
      setNotice(result.error ?? "名称目录更新启动失败");
      return;
    }
    setCatalogTask(result.catalogTask);
  };

  const updateCnMaintenance = async (
    action: "start" | "pause" | "resume",
    mode: "incremental" | "repair" = "incremental",
  ) => {
    if (action !== "pause" && !configured.tushare) {
      setNotice("请先进入“设置 → 数据源设置”配置 Tushare Token。");
      onOpenSettings?.();
      return;
    }
    if (action === "start") {
      const prompt = mode === "incremental"
        ? "系统将从本地最后日期之后，按工作日使用 Tushare 一次拉取全市场不复权股票日线。确定开始吗？"
        : "系统将回查最近 30 个自然日，只补本地缺失或与来源不一致的普通 A 股日线；停牌和休市不会造数据。确定开始吗？";
      if (!window.confirm(prompt)) return;
    }
    setMaintenanceBusy(true);
    setNotice(action === "pause"
      ? "正在安全暂停 A 股维护任务……"
      : mode === "repair" ? "正在建立最近 30 日缺口回查任务……" : "正在建立每日增量任务……");
    try {
      const response = await fetch("/api/cn-maintenance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, mode, repairDays: 30 }),
      });
      const result = await response.json() as {
        maintenanceTask?: CnMaintenanceTask | null;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "A 股维护任务操作失败");
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
        const response = await fetch("/api/data-jobs/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const result = await response.json() as {
          status?: DownloadJob["status"];
          complete?: boolean;
          insertedCount?: number;
          error?: string;
        };
        await loadJobs();
        if (!response.ok) throw new Error(result.error ?? "下载失败");
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
    if (!window.confirm("拉取通达信最新 A 股完整日线包？现有数据在更新完成前仍可使用，预计下载约 520 MB。")) return;
    setNotice("正在创建 A 股市场更新任务；系统会下载最新完整包并自动替换发生变化的分区。");
    const removeResponse = await fetch("/api/local-data", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ removeData: false }),
    });
    if (!removeResponse.ok) {
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
    });
  };

  const runMarketSync = useCallback(async (runId: string) => {
    if (marketSyncLoopRef.current === runId) return;
    marketSyncLoopRef.current = runId;
    setMarketSyncBusy(true);
    let networkFailures = 0;
    try {
      while (aliveRef.current) {
        let response: Response | null = null;
        let data: {
          run?: MarketSyncStatus["run"];
          currentBatch?: MarketSyncStatus["currentBatch"];
          pendingBatches?: number;
          runningBatches?: number;
          failedBatches?: number;
          error?: string;
        } | null = null;
        try {
          response = await fetch("/api/data-jobs/market/sync/worker", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ runId }),
          });
          data = await response.json();
        } catch (error) {
          networkFailures += 1;
          setNotice(error instanceof Error ? error.message : "美股批次执行网络失败，正在等待后重试");
          if (networkFailures >= 5) break;
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          continue;
        }
        if (!response || !response.ok || !data?.run) {
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
        try {
          await loadJobs();
        } catch {
          // A status update must continue even if the auxiliary job list is offline.
        }
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
        if (["completed", "completed_with_errors", "cancelled", "paused"].includes(next.run.status)) {
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
  }, [loadJobs, loadMarketSync, notifyDataChanged, setNotice]);

  const syncUsMarket = async (mode: "initialize" | "update") => {
    if (!configured.alpaca) {
      setNotice("请先进入“设置 → 数据源设置”配置 Alpaca 免费账户密钥。");
      return;
    }
    const message = mode === "initialize"
      ? "初始化会读取 Alpaca 的活跃可交易美股目录，并从 2016 年开始批量下载 SIP/IEX 日线。任务可能较多，可以随时暂停，确定继续吗？"
      : "只同步最新已收盘日线：服务端会根据缺失交易日和 URL 长度自动计算批量。不会删除旧训练快照，确定继续吗？";
    if (!window.confirm(message)) return;
    try {
    setMarketSyncBusy(true);
    setNotice(mode === "initialize"
      ? "正在创建可恢复的美股历史初始化任务……"
      : "正在创建可恢复的美股最新日线任务……");
    const response = await fetch("/api/data-jobs/market/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ market: "US", mode }),
    });
    const result = await response.json() as {
      run?: MarketSyncStatus["run"];
      currentBatch?: MarketSyncStatus["currentBatch"];
      pendingBatches?: number;
      runningBatches?: number;
      failedBatches?: number;
      error?: string;
    };
    if (!response.ok || !result.run) {
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
      const response = await fetch("/api/data-jobs/market/sync", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, action }),
      });
      const result = await response.json() as { run?: MarketSyncStatus["run"]; error?: string };
      if (!response.ok || !result.run) throw new Error(result.error ?? "美股同步任务操作失败");
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
          const response = await fetch("/api/fx-data/run", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ taskId }),
          });
          const data = await response.json() as { task?: FxDataTask | null; error?: string };
          if (data.task) {
            setFxTask(data.task);
            setFxQuality(data.task.quality ?? null);
          }
          if (data.task && ["completed", "failed", "cancelled", "paused"].includes(data.task.status)) {
            if (data.task.status === "completed") notifyDataChanged();
            break;
          }
          if (!response.ok || !data.task) {
            failures += 1;
            retryDelayMs = Math.min(30_000, 1_000 * 2 ** Math.min(failures - 1, 5));
            setNotice(`${data.error ?? "外汇任务请求暂时失败"}，${Math.ceil(retryDelayMs / 1_000)} 秒后自动重试（第 ${failures} 次）`);
          } else {
            if (failures) setNotice("");
            failures = 0;
            retryDelayMs = 250;
          }
        } catch (error) {
          failures += 1;
          retryDelayMs = Math.min(30_000, 1_000 * 2 ** Math.min(failures - 1, 5));
          const message = error instanceof Error ? error.message : "外汇任务网络请求失败";
          setNotice(`${message}，${Math.ceil(retryDelayMs / 1_000)} 秒后自动重试（第 ${failures} 次）`);
        }
        await new Promise((resolve) => window.setTimeout(resolve, retryDelayMs));
      }
    } finally {
      fxTaskLoopRef.current = null;
      await loadFxTask();
    }
  }, [loadFxTask, notifyDataChanged, setNotice]);

  useEffect(() => {
    if (market !== "FX" || !fxTask || !["queued", "running"].includes(fxTask.status)) return;
    if (fxTaskLoopRef.current !== fxTask.id) void runFxTask(fxTask.id);
  }, [fxTask, market, runFxTask]);

  const handleFxAction = async (action: FxDataControlAction) => {
    const isTaskAction = action.type === "task";
    const response = await fetch(action.apiPath, {
      method: isTaskAction ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(isTaskAction
        ? { taskId: action.taskId, action: action.action }
        : { ...action.payload }),
    });
    const data = await response.json() as { task?: FxDataTask | null; error?: string };
    if (!response.ok || !data.task) throw new Error(data.error ?? "外汇任务操作失败");
    setFxTask(data.task);
    setFxQuality(data.task.quality ?? null);
    if (action.type !== "task" || action.action === "resume" || action.action === "retry") void runFxTask(data.task.id);
  };

  const updateJob = async (job: DownloadJob, action: "pause" | "resume" | "retry") => {
    if (job.syncRunId) {
      setNotice("美股批量任务请使用市场同步面板操作");
      return;
    }
    await fetch("/api/data-jobs", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: job.id, action }),
    });
    await loadJobs();
    if (action !== "pause") void runJob(job.id);
  };

  const deleteJob = async (job: DownloadJob) => {
    if (job.syncRunId) {
      setNotice("美股批量任务不支持单独删除");
      return;
    }
    if (!window.confirm("只删除这条下载任务记录？已经导入的 K 线会保留。")) return;
    await fetch(`/api/data-jobs?id=${encodeURIComponent(job.id)}`, { method: "DELETE" });
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
            <p>无需账号、Token 或通达信客户端，一次建立沪深京 A 股完整日线库。</p>
            <ul>
              <li><CircleCheck size={14} />A 股与主要指数，包含退市股票</li>
              <li><CircleCheck size={14} />自动识别证券类型，中文名按本地目录匹配</li>
              <li><CircleCheck size={14} />由日线生成周线</li>
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
              <li><CircleCheck size={14} />Tushare 日线与增量更新</li>
              <li><CircleCheck size={14} />TdxQuant 5m / 1h 数据</li>
              <li><CircleCheck size={14} />Alpaca 美股历史行情</li>
              <li><CircleCheck size={14} />本地通达信 ZIP 与 CSV</li>
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
          <div className="setup-ready"><ShieldCheck size={20} /><span><strong>无需任何凭证</strong><small>证券类型识别与内置名称目录不需要 Token</small></span></div>
        </div>

        <div className="quick-plan-grid">
          <div><span>市场与品种</span><strong>沪深京 A 股＋交易所指数</strong><small>包含当前上市及已退市股票</small></div>
          <div><span>历史范围</span><strong>全部可用历史</strong><small>避免随机训练出现幸存者偏差</small></div>
          <div><span>基础周期</span><strong>日线</strong><small>导入后自动生成周线</small></div>
          <div><span>行情来源</span><strong>通达信官方完整包</strong><small>不安装、不登录通达信客户端</small></div>
        </div>

        <div className="snapshot-explainer">
          <ShieldCheck size={20} />
          <div><strong>锁定训练数据版本</strong><p>第一次保存完整版本，后续更新只保存新增或修正的差异；不会为每场训练复制整套数据库，也不会常驻内存。</p></div>
          <span>推荐开启</span>
        </div>

        <div className="setup-pipeline">
          {["加载本地品种目录", "下载完整日线包", "校验并识别品种", "导入日线", "生成周线", "建立版本清单"].map((item, index) => (
            <div key={item}><span>{index + 1}</span><strong>{item}</strong>{index < 5 && <ArrowRight size={14} />}</div>
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
            });
          }}><CloudDownload size={15} />开始快速初始化</button>
        </div>
      </section>
    );
  }

  if (effectiveSetupView === "advanced") {
    const needsTdxQuant = advanced.minimumTimeframe !== "1d";
    const assets = [
      advanced.stocks && "A股股票",
      advanced.indices && "交易所指数",
      advanced.funds && "场内基金",
      advanced.convertibleBonds && "可转债",
    ].filter(Boolean).join("、") || "尚未选择";
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
                  <div className="advanced-group-head"><strong>A 股品种</strong><small>完整包只下载一次，选择项主要影响导入后的磁盘占用。</small></div>
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
                  {([
                    ["1d", "日线", "生成周线 · 无需客户端"],
                    ["1h", "1小时", "生成日线、周线 · 需要 TdxQuant"],
                    ["5m", "5分钟", "生成1小时、日线、周线 · 需要 TdxQuant"],
                  ] as const).map(([value, label, hint]) => (
                    <button key={value} className={advanced.minimumTimeframe === value ? "selected" : ""} onClick={() => setAdvanced((current) => ({
                      ...current,
                      minimumTimeframe: value,
                      intradaySource: value === "1d" ? "none" : "tdxquant",
                    }))}>
                      <span>{advanced.minimumTimeframe === value && <Check size={14} />}</span><strong>{label}</strong><small>{hint}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="advanced-group">
                <div className="advanced-group-head"><strong>历史范围</strong><small>通达信完整包始终下载一次；范围决定实际导入量。</small></div>
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
                  <label>首次 A 股完整日线
                    <select value={advanced.cnInitialSource} onChange={(event) => setAdvanced((value) => ({ ...value, cnInitialSource: event.target.value as AdvancedSetup["cnInitialSource"] }))}>
                      <option value="tdx-zip">通达信官方日线完整包（推荐，无需 Token）</option>
                      <option value="local-zip">选择本机已有通达信 ZIP</option>
                      <option value="tushare">Tushare 逐批下载</option>
                    </select>
                  </label>
                  <label>日线增量更新
                    <select value={advanced.cnIncrementalSource} onChange={(event) => setAdvanced((value) => ({ ...value, cnIncrementalSource: event.target.value as AdvancedSetup["cnIncrementalSource"] }))}>
                      <option value="none">暂不配置，手动更新完整包</option>
                      <option value="tushare">Tushare（120积分可用于A股不复权日线）</option>
                      <option value="tdxquant">TdxQuant</option>
                    </select>
                  </label>
                  {needsTdxQuant && (
                    <label>5m / 1h 分钟数据
                      <select value={advanced.intradaySource} onChange={(event) => setAdvanced((value) => ({ ...value, intradaySource: event.target.value as AdvancedSetup["intradaySource"] }))}>
                        <option value="tdxquant">TdxQuant 本地客户端</option>
                        <option value="none">暂不下载分钟数据</option>
                      </select>
                    </label>
                  )}
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
                <div className="ready"><CircleCheck size={16} /><span><strong>通达信完整包</strong><small>可用 · 无需登录</small></span></div>
                <div className={configured.tushare ? "ready" : ""}><span className="status-dot" /><span><strong>Tushare</strong><small>{configured.tushare ? "本机已配置" : "尚未配置"}</small></span></div>
                <div className={configured.tdxquant ? "ready" : ""}><span className="status-dot" /><span><strong>TdxQuant</strong><small>{configured.tdxquant ? "端点已保存" : "尚未配置"}</small></span></div>
                <div className={configured.alpaca ? "ready" : ""}><span className="status-dot" /><span><strong>Alpaca</strong><small>{configured.alpaca ? "本机已配置" : "尚未配置"}</small></span></div>
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
                <div><span>A股首次来源</span><strong>{{ "tdx-zip": "通达信官方完整包", "local-zip": "本机通达信 ZIP", tushare: "Tushare" }[advanced.cnInitialSource]}</strong></div>
                <div><span>版本锁定</span><strong>开启 · 仅保存差异和被引用版本</strong></div>
              </div>
              {needsTdxQuant && advanced.intradaySource === "tdxquant" && !configured.tdxquant && (
                <div className="setup-warning">分钟数据已选择 TdxQuant，但尚未保存本机端点。可以先保存方案，日线初始化不受影响。</div>
              )}
              {advanced.usMarket && advanced.usSource === "alpaca" && !configured.alpaca && (
                <div className="setup-warning">美股已选择 Alpaca，但尚未配置 API Key。可以先完成 A 股初始化。</div>
              )}
              {advanced.cnIncrementalSource === "tushare" && !configured.tushare && (
                <div className="setup-warning">Tushare 尚未配置 Token；首次完整包导入不受影响，增量更新会保持等待。</div>
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
              if (advanced.cnMarket && advanced.cnInitialSource === "tdx-zip") {
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
                });
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
      description: "完整库由通达信官方日线包建立；之后直接按市场拉取最新版本，无需逐个输入证券代码。",
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

  return (
    <section className="data-source-manager">
      <div className="data-source-head">
        <div>
          <span className="section-label">{marketCopy.label} · 真实历史行情</span>
          <h2>{marketCopy.title}</h2>
          <p>{marketCopy.description}</p>
        </div>
        <div className="data-source-head-actions">
          {market === "CN" && <button className="ghost-button" onClick={() => setSetupView("welcome")}><SlidersHorizontal size={15} />初始化设置</button>}
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
          <button onClick={() => setSetupView(savedPlan.kind === "quick" ? "quick" : "advanced")}>查看或修改</button>
        </div>
      )}

      {market === "CN" && (
        <div className={`local-initialization-card ${localTask?.status ?? "idle"}`}>
          <div className="local-task-icon"><FileArchive size={20} /></div>
          <div className="local-task-copy">
            <span>TDX A 股全市场日线库</span>
            <strong>{localTask
              ? {
                  queued: "等待开始",
                  running: "正在拉取最新市场数据",
                  paused: "已暂停",
                  completed: "初始化完成，可拉取更新",
                  failed: "需要处理",
                }[localTask.status]
              : localServiceAvailable ? "尚未初始化" : "本机数据服务未启动"}</strong>
            <small>{localTask?.error || localTask?.message || (localServiceAvailable
              ? "从初始化设置开始，一次建立全市场日线和周线，无需逐个代码下载。"
              : "请关闭当前窗口后重新双击“启动本地网页版.bat”。")}</small>
            {catalogTask && <small className="catalog-task-status">
              中文名称：{catalogTask.error || catalogTask.message}
            </small>}
            {localTask && (
              <div className="local-task-progress">
                <i style={{ width: `${localTask.status === "completed"
                  ? 100
                  : localTask.stage === "downloading"
                    ? Math.min(100, localTask.progress.totalBytes
                      ? localTask.progress.downloadedBytes / localTask.progress.totalBytes * 100
                      : 0)
                    : localTask.progress.totalFiles
                      ? localTask.progress.processedFiles / localTask.progress.totalFiles * 100
                      : localTask.stage === "verifying" ? 4 : 0}%` }} />
              </div>
            )}
          </div>
          {localTask && (
            <div className="local-task-metrics">
              <span><strong>{localTask.stage === "downloading"
                ? `${(localTask.progress.downloadedBytes / 1024 / 1024).toFixed(1)} MB`
                : localTask.progress.processedFiles.toLocaleString()}</strong><small>{localTask.stage === "downloading" ? "已下载" : "已扫描文件"}</small></span>
              <span><strong>{localTask.progress.indexedInstruments.toLocaleString()}</strong><small>已索引品种</small></span>
            </div>
          )}
          <div className="local-task-actions">
            {localTask?.status === "completed" && <button disabled={catalogTask?.status === "running"} onClick={() => void refreshCnMarket()}><CloudDownload size={14} />刷新完整基础包</button>}
            {localTask?.status === "completed" && catalogTask?.status !== "running" && <button onClick={() => void refreshCatalog()}><RefreshCw size={14} />更新中文名称</button>}
            {localTask?.status === "running" && <button onClick={() => void updateLocalTask("pause")}><Pause size={14} />暂停</button>}
            {(localTask?.status === "paused" || localTask?.status === "failed") && <button onClick={() => void updateLocalTask("resume")}><Play size={14} />继续</button>}
            {localTask && !["running", "queued"].includes(localTask.status) && <button className="danger" onClick={() => void removeLocalTaskRecord()}><Trash2 size={14} />移除任务记录</button>}
          </div>
        </div>
      )}

      {market === "CN" && localTask?.status === "completed" && (
        <div className={`market-maintenance-card ${configured.tushare ? "ready" : ""} ${cnMaintenanceTask?.status === "failed" ? "failed" : ""}`}>
          <div className="market-maintenance-icon"><Database size={22} /></div>
          <div>
            <span>TUSHARE 120 · A 股日线维护</span>
            <strong>{cnMaintenanceTask
              ? {
                  queued: "等待开始",
                  running: cnMaintenanceTask.mode === "repair" ? "正在扫描并修复缺口" : "正在拉取每日增量",
                  paused: "维护任务已暂停",
                  completed: cnMaintenanceTask.mode === "repair" ? "缺口回查已完成" : "每日增量已完成",
                  failed: "维护任务需要处理",
                }[cnMaintenanceTask.status]
              : configured.tushare ? "可以进行每日增量和缺口修复" : "尚未配置 Tushare Token"}</strong>
            <small>{cnMaintenanceTask?.error || cnMaintenanceTask?.message || (configured.tushare
              ? "按日期一次拉取全市场普通股票不复权日线；指数、基金和可转债仍由上方 TDX 基础包维护。"
              : "Token 只保存在本机设置中，不会写入维护任务或数据文件。")}</small>
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
                </small>
              </>
            )}
          </div>
          <div className="market-maintenance-actions">
            {!configured.tushare && <button onClick={onOpenSettings}><Settings2 size={14} />配置 Tushare</button>}
            {configured.tushare && !["queued", "running", "paused", "failed"].includes(cnMaintenanceTask?.status ?? "") && (
              <>
                <button className="primary" disabled={maintenanceBusy} onClick={() => void updateCnMaintenance("start", "incremental")}>
                  <CloudDownload size={14} />每日增量更新
                </button>
                <button disabled={maintenanceBusy} onClick={() => void updateCnMaintenance("start", "repair")}>
                  <RefreshCw size={14} />扫描并修复缺口
                </button>
              </>
            )}
            {configured.tushare && ["queued", "running"].includes(cnMaintenanceTask?.status ?? "") && (
              <button className="danger" disabled={maintenanceBusy} onClick={() => void updateCnMaintenance("pause")}>
                <Pause size={14} />暂停维护
              </button>
            )}
            {configured.tushare && ["paused", "failed"].includes(cnMaintenanceTask?.status ?? "") && (
              <button className="primary" disabled={maintenanceBusy} onClick={() => void updateCnMaintenance("resume", cnMaintenanceTask?.mode ?? "incremental")}>
                <Play size={14} />继续维护
              </button>
            )}
          </div>
        </div>
      )}

      {market === "US" && (
        <div className={`market-maintenance-card ${configured.alpaca ? "ready" : ""}`}>
          <div className="market-maintenance-icon"><Database size={22} /></div>
          <div>
            <span>ALPACA · SIP/IEX 历史行情</span>
            <strong>{usInitialized
              ? "美股市场库已建立"
              : usStarted ? `初始化未完成：还剩 ${usRemaining.toLocaleString()} 个品种` : "美股市场库尚未初始化"}</strong>
            <small>{usInitialized
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
              <button className="primary" onClick={() => void syncUsMarket(usStarted ? "update" : "initialize")}>
                <CloudDownload size={14} />{usInitialized
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

      {market === "FX" && (
        <FxDataControlPanel
          apiPaths={{ initialize: "/api/fx-data/initialize", update: "/api/fx-data/update", task: "/api/fx-data/task" }}
          currentTask={fxTask}
          qualitySummary={fxQuality}
          currencyPairs={DEFAULT_FX_CURRENCY_PAIRS}
          defaultStartDate="2020-01-01"
          defaultEndDate={new Date().toISOString().slice(0, 10)}
          onAction={handleFxAction}
          onRefreshStatus={async () => { await loadFxTask(); }}
        />
      )}

      {market === "GOLD" && (
        <div className="market-maintenance-card unavailable">
          <div className="market-maintenance-icon"><Database size={22} /></div>
          <div>
            <span>METALS DATASET</span>
            <strong>黄金数据源尚未接入</strong>
            <small>这里已经与 A 股、美股完全分开。接入数据源后会在本市场内完成初始化、更新、覆盖检查和删除。</small>
          </div>
          <div className="market-maintenance-actions"><button disabled>等待接入</button></div>
        </div>
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
                <span><strong>{job.instrumentId} · {job.timeframe}</strong><small>{job.provider} / {job.vendorSymbol}</small></span>
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
