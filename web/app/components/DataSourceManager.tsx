"use client";

import { CloudDownload, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type ProviderId = "tushare" | "alpaca";
type Provider = {
  id: ProviderId;
  name: string;
  market: string;
  configured: boolean;
  supportedTimeframes: string[];
};
type DownloadJob = {
  id: string;
  provider: ProviderId;
  instrumentId: string;
  vendorSymbol: string;
  instrumentName: string;
  market: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  status: "queued" | "running" | "paused" | "completed" | "failed";
  insertedCount: number;
  qualityReportJson: string;
  lastError?: string;
  updatedAt: string;
};

const today = new Date().toISOString().slice(0, 10);
const defaultStart = `${new Date().getUTCFullYear() - 5}-01-01`;

function providerDefaults(provider: ProviderId) {
  return provider === "tushare"
    ? { instrumentId: "600519.SH", vendorSymbol: "600519.SH", instrumentName: "贵州茅台", market: "CN" }
    : { instrumentId: "AAPL.US", vendorSymbol: "AAPL", instrumentName: "Apple", market: "US" };
}

function statusLabel(status: DownloadJob["status"]) {
  return {
    queued: "等待下载",
    running: "下载中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
  }[status];
}

export function DataSourceManager({ onDataChanged }: { onDataChanged?: () => void }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [providerId, setProviderId] = useState<ProviderId>("alpaca");
  const [form, setForm] = useState({
    ...providerDefaults("alpaca"),
    timeframe: "1d",
    startDate: defaultStart,
    endDate: today,
  });
  const [notice, setNotice] = useState("");
  const [activeJobId, setActiveJobId] = useState("");
  const aliveRef = useRef(true);

  const loadProviders = useCallback(async () => {
    const response = await fetch("/api/data-providers");
    if (!response.ok) return;
    const data = await response.json() as { providers: Provider[] };
    setProviders(data.providers);
  }, []);

  const loadJobs = useCallback(async () => {
    const response = await fetch("/api/data-jobs");
    if (!response.ok) return;
    const data = await response.json() as { jobs: DownloadJob[] };
    setJobs(data.jobs);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    const timer = window.setTimeout(() => {
      void Promise.all([loadProviders(), loadJobs()]);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      aliveRef.current = false;
    };
  }, [loadJobs, loadProviders]);

  useEffect(() => {
    const reload = () => {
      void loadProviders();
    };
    window.addEventListener("provider-settings-updated", reload);
    return () => window.removeEventListener("provider-settings-updated", reload);
  }, [loadProviders]);

  const selectProvider = (nextProvider: ProviderId) => {
    setProviderId(nextProvider);
    setForm((current) => ({ ...current, ...providerDefaults(nextProvider) }));
    setNotice("");
  };

  const runJob = async (id: string) => {
    setActiveJobId(id);
    setNotice("正在分批下载并校验 K 线，可随时暂停。");
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
          setNotice(result.status === "paused"
            ? "任务已暂停，进度已经保存。"
            : `下载完成，累计处理 ${Number(result.insertedCount ?? 0).toLocaleString()} 根 K 线。`);
          onDataChanged?.();
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "下载失败");
      await loadJobs();
    } finally {
      setActiveJobId("");
    }
  };

  const createJob = async () => {
    const configured = providers.find((provider) => provider.id === providerId)?.configured;
    if (!configured) {
      setNotice("这个数据源尚未配置，请先进入侧栏“设置 → 数据源设置”保存个人凭证。");
      return;
    }
    setNotice("正在创建下载任务…");
    const response = await fetch("/api/data-jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: providerId, ...form }),
    });
    const result = await response.json() as { id?: string; error?: string };
    if (!response.ok || !result.id) {
      setNotice(result.error ?? "创建下载任务失败");
      return;
    }
    await loadJobs();
    void runJob(result.id);
  };

  const updateJob = async (job: DownloadJob, action: "pause" | "resume" | "retry") => {
    await fetch("/api/data-jobs", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: job.id, action }),
    });
    await loadJobs();
    if (action !== "pause") void runJob(job.id);
  };

  const deleteJob = async (job: DownloadJob) => {
    if (!window.confirm("只删除这条下载任务记录？已经导入的 K 线会保留。")) return;
    await fetch(`/api/data-jobs?id=${encodeURIComponent(job.id)}`, { method: "DELETE" });
    await loadJobs();
  };

  return (
    <section className="data-source-manager">
      <div className="data-source-head">
        <div>
          <span className="section-label">真实历史行情</span>
          <h2>数据源与下载任务</h2>
          <p>A 股使用 Tushare，美股使用 Alpaca。任务按页保存进度，失败或暂停后可继续。</p>
        </div>
        <CloudDownload size={24} />
      </div>

      <div className="provider-grid">
        {providers.map((provider) => (
          <button
            key={provider.id}
            className={`${providerId === provider.id ? "active" : ""} ${provider.configured ? "configured" : ""}`}
            onClick={() => selectProvider(provider.id)}
          >
            <span>{provider.market}</span>
            <strong>{provider.name}</strong>
            <small>{provider.configured ? "凭证已配置" : "等待本地凭证"}</small>
          </button>
        ))}
      </div>

      <div className="download-form">
        <label>供应商代码<input value={form.vendorSymbol} onChange={(event) => setForm({ ...form, vendorSymbol: event.target.value.trim().toUpperCase() })} placeholder={providerId === "alpaca" ? "AAPL" : "600519.SH"} /></label>
        <label>本地品种 ID<input value={form.instrumentId} onChange={(event) => setForm({ ...form, instrumentId: event.target.value.trim().toUpperCase() })} placeholder={providerId === "alpaca" ? "AAPL.US" : "600519.SH"} /></label>
        <label>品种名称<input value={form.instrumentName} onChange={(event) => setForm({ ...form, instrumentName: event.target.value })} /></label>
        <label>周期<select value={form.timeframe} onChange={(event) => setForm({ ...form, timeframe: event.target.value })}>{["5m", "1h", "1d", "1w"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>开始日期<input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>
        <label>结束日期<input type="date" value={form.endDate} max={today} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label>
        <button className="primary-button download-submit" disabled={!form.vendorSymbol || !form.instrumentId || !form.instrumentName || Boolean(activeJobId)} onClick={createJob}>
          <CloudDownload size={16} />创建并开始下载
        </button>
      </div>

      {providerId === "tushare" && <div className="provider-note">5m / 1h 分钟线需要 Tushare 的历史分钟权限；日线和周线按账户现有权限调用。</div>}
      {notice && <div className="status-banner">{notice}</div>}

      <div className="download-job-list">
        <div className="download-job-header"><span>任务</span><span>范围</span><span>进度 / 质量</span><span>状态</span><span>操作</span></div>
        {jobs.length ? jobs.map((job) => {
          const quality = JSON.parse(job.qualityReportJson || "{}") as { invalid?: number; duplicates?: number };
          return (
            <div className="download-job-row" key={job.id}>
              <span><strong>{job.instrumentId} · {job.timeframe}</strong><small>{job.provider} / {job.vendorSymbol}</small></span>
              <span><strong>{job.startDate} — {job.endDate}</strong><small>{job.instrumentName}</small></span>
              <span><strong>{Number(job.insertedCount).toLocaleString()} 根</strong><small>无效 {quality.invalid ?? 0} · 重复 {quality.duplicates ?? 0}</small></span>
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
        }) : <div className="download-empty">还没有真实行情下载任务。</div>}
      </div>
    </section>
  );
}
