"use client";

import { Clock, KeyRound, Link2, RefreshCw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createMarketDataGateway } from "../marketDataGateway";
import { DEFAULT_DATA_AUTO_UPDATE_SCHEDULE_TIME } from "../../../lib/dataAutoUpdateSettings";

type ProviderState = {
  configured: boolean;
  source: "settings" | "environment" | "builtin" | null;
  hint?: string;
  keyIdHint?: string;
  endpoint?: string;
};

type ProviderSettingsResponse = {
  providers: {
    baostock: ProviderState;
    tushare: ProviderState;
    alpaca: ProviderState;
    tdxquant: ProviderState;
    dukascopy: ProviderState;
  };
  autoUpdate?: {
    enabled: boolean;
    scheduledEnabled: boolean;
    scheduledTime: string;
    lastCheckDate: string | null;
    lastFinishedAt: string | null;
    lastStatus: "idle" | "running" | "completed" | "partial" | "failed" | "deferred";
    lastMessage: string;
  };
};

const emptyStatus: ProviderSettingsResponse["providers"] = {
  baostock: { configured: true, source: "builtin" },
  tushare: { configured: false, source: null },
  alpaca: { configured: false, source: null },
  tdxquant: { configured: false, source: null },
  dukascopy: { configured: false, source: null },
};

function sourceLabel(source: ProviderState["source"]) {
  if (source === "settings") return "已保存在本机设置";
  if (source === "environment") return "已配置";
  if (source === "builtin") return "已启用内置数据源";
  return "尚未配置";
}

export function ProviderSettingsPanel() {
  const [status, setStatus] = useState(emptyStatus);
  const [tushareToken, setTushareToken] = useState("");
  const [alpacaKeyId, setAlpacaKeyId] = useState("");
  const [alpacaSecretKey, setAlpacaSecretKey] = useState("");
  const [tdxQuantEndpoint, setTdxQuantEndpoint] = useState("http://127.0.0.1:17709");
  const [dukascopyEndpoint, setDukascopyEndpoint] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState<"" | "tushare" | "alpaca" | "tdxquant" | "dukascopy">("");
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);
  const [autoUpdateScheduledEnabled, setAutoUpdateScheduledEnabled] = useState(false);
  const [autoUpdateScheduleTime, setAutoUpdateScheduleTime] = useState(DEFAULT_DATA_AUTO_UPDATE_SCHEDULE_TIME);
  const [autoUpdateStatus, setAutoUpdateStatus] = useState<ProviderSettingsResponse["autoUpdate"]>();
  const [autoUpdateSaving, setAutoUpdateSaving] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const autoUpdateScheduleTimeDirtyRef = useRef(false);
  const marketDataGateway = useMemo(
    () => createMarketDataGateway((input, init) => fetch(input, init)),
    [],
  );

  const loadStatus = useCallback(async () => {
    try {
      const data = await marketDataGateway.loadProviderSettings<ProviderSettingsResponse>();
      setStatus(data.providers);
      setAutoUpdateEnabled(Boolean(data.autoUpdate?.enabled));
      setAutoUpdateScheduledEnabled(Boolean(data.autoUpdate?.scheduledEnabled));
      if (!autoUpdateScheduleTimeDirtyRef.current) {
        setAutoUpdateScheduleTime(data.autoUpdate?.scheduledTime ?? DEFAULT_DATA_AUTO_UPDATE_SCHEDULE_TIME);
      }
      setAutoUpdateStatus(data.autoUpdate);
      setStatusLoaded(true);
      if (data.providers.tdxquant.endpoint) setTdxQuantEndpoint(data.providers.tdxquant.endpoint);
      setDukascopyEndpoint(data.providers.dukascopy.endpoint ?? "");
      return true;
    } catch {
      setStatusLoaded(false);
      return false;
    }
  }, [marketDataGateway]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer = 0;
    const refresh = async () => {
      const loaded = await loadStatus();
      if (!loaded && !cancelled) {
        retryTimer = window.setTimeout(() => void refresh(), 1200);
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, [loadStatus]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadStatus();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [loadStatus]);

  const saveAutoUpdate = async (enabled: boolean) => {
    setAutoUpdateSaving(true);
    setNotice("");
    try {
      const result = await marketDataGateway.saveProviderSettings<{ autoUpdate?: ProviderSettingsResponse["autoUpdate"]; error?: string }>({ autoUpdateEnabled: enabled });
      if (!result.autoUpdate) throw new Error(result.error ?? "保存自动更新设置失败");
      setAutoUpdateEnabled(result.autoUpdate.enabled);
      setAutoUpdateStatus(result.autoUpdate);
      window.dispatchEvent(new Event("provider-settings-updated"));
      window.dispatchEvent(new Event("data-auto-update-settings-updated"));
      setNotice(enabled ? "已开启：下次启动后会检查已有市场，只有发现缺口才会拉取。" : "每日启动自动更新已关闭。已有数据不会被删除。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存自动更新设置失败");
    } finally {
      setAutoUpdateSaving(false);
    }
  };

  const saveAutoUpdateSchedule = async (patch: { enabled?: boolean; time?: string }) => {
    const scheduledEnabled = patch.enabled ?? autoUpdateScheduledEnabled;
    const scheduledTime = patch.time ?? autoUpdateScheduleTime;
    setAutoUpdateSaving(true);
    setNotice("");
    try {
      const result = await marketDataGateway.saveProviderSettings<{ autoUpdate?: ProviderSettingsResponse["autoUpdate"]; error?: string }>({
        autoUpdateScheduledEnabled: scheduledEnabled,
        autoUpdateScheduleTime: scheduledTime,
      });
      if (!result.autoUpdate) throw new Error(result.error ?? "保存定时自动更新设置失败");
      setAutoUpdateScheduledEnabled(Boolean(result.autoUpdate.scheduledEnabled));
      setAutoUpdateScheduleTime(result.autoUpdate.scheduledTime ?? scheduledTime);
      autoUpdateScheduleTimeDirtyRef.current = false;
      setAutoUpdateStatus(result.autoUpdate);
      window.dispatchEvent(new Event("provider-settings-updated"));
      window.dispatchEvent(new Event("data-auto-update-settings-updated"));
      setNotice(scheduledEnabled
        ? `已开启：每天 ${scheduledTime}（系统时间）自动检查已有市场。`
        : "每日定时自动更新已关闭。已有数据不会被删除。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存定时自动更新设置失败");
    } finally {
      setAutoUpdateSaving(false);
    }
  };

  const saveProvider = async (provider: "tushare" | "alpaca" | "tdxquant" | "dukascopy") => {
    setSaving(provider);
    setNotice("");
    try {
      await marketDataGateway.saveProviderSettings<{ error?: string }>(provider === "tushare"
        ? { provider, tushareToken }
        : provider === "alpaca"
          ? { provider, alpacaKeyId, alpacaSecretKey }
          : provider === "tdxquant"
          ? { provider, tdxQuantEndpoint }
          : { provider, dukascopyEndpoint });
      setAlpacaKeyId("");
      setAlpacaSecretKey("");
      setTushareToken("");
      await loadStatus();
      window.dispatchEvent(new Event("provider-settings-updated"));
      setNotice(provider === "tushare"
        ? "Tushare 服务密钥已保存在本机；日线价格保持不复权。"
        : provider === "tdxquant"
        ? "TdxQuant 服务地址已保存；可按服务地址选择复权口径，使用分钟数据前请完成行情终端连接。"
        : provider === "dukascopy"
            ? "Dukascopy 自定义 CSV 地址已保存在本机。"
            : "Alpaca 凭证已保存在本机。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving("");
    }
  };

  const clearProvider = async (provider: "tushare" | "alpaca" | "tdxquant" | "dukascopy") => {
    const label = provider === "tushare" ? "Tushare" : provider === "alpaca" ? "Alpaca" : provider === "tdxquant" ? "TdxQuant" : "Dukascopy";
    if (!window.confirm(`清除本机保存的 ${label} 配置？`)) return;
    try {
      const result = await marketDataGateway.deleteProviderSettings<{ error?: string }>(provider);
      if (result.error) {
        setNotice(result.error);
        return;
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "清除失败");
      return;
    }
    await loadStatus();
    window.dispatchEvent(new Event("provider-settings-updated"));
    setNotice("本机保存的凭证已清除。");
  };

  return (
    <div className="settings-section provider-settings-section">
      <div className="settings-section-head">
        <strong>历史行情数据源</strong>
        <span>首次使用：先确认数据服务状态，再到“数据”页面建立训练数据。连接凭证只保存在本机，页面不会显示完整内容。</span>
      </div>

      <article className="provider-setting-card auto-update-setting-card">
        <div className="provider-setting-title">
          <div><RefreshCw size={17} /><span><strong>每日启动自动检查更新</strong><small>只处理已经存在历史数据的市场</small></span></div>
          <button
            type="button"
            className="indicator-switch"
            role="switch"
            aria-checked={autoUpdateEnabled}
            aria-label="每日启动自动检查更新"
            disabled={autoUpdateSaving || !statusLoaded}
            onClick={() => void saveAutoUpdate(!autoUpdateEnabled)}
          ><span /></button>
        </div>
        <p className="provider-setting-help">启动后先检查 A 股、美股和外汇的最新已收盘数据；已经是最新就跳过，不会为没有历史数据的市场创建初始化任务。</p>
        <small className="auto-update-setting-status">
          {autoUpdateStatus?.lastCheckDate
            ? `上次检查：${autoUpdateStatus.lastCheckDate} · ${autoUpdateStatus.lastMessage || "已完成"}`
            : "尚未执行过自动检查"}
        </small>
      </article>

      <article className="provider-setting-card auto-update-setting-card">
        <div className="provider-setting-title">
          <div><Clock size={17} /><span><strong>每日定时检查更新</strong><small>错过时间启动时会立即检查</small></span></div>
          <button
            type="button"
            className="indicator-switch"
            role="switch"
            aria-checked={autoUpdateScheduledEnabled}
            aria-label="每日定时检查更新"
            disabled={autoUpdateSaving || !statusLoaded}
            onClick={() => void saveAutoUpdateSchedule({ enabled: !autoUpdateScheduledEnabled })}
          ><span /></button>
        </div>
        <div className="auto-update-schedule-controls">
          <label>每日检查时间（系统时间）
            <input
              type="time"
              value={autoUpdateScheduleTime}
              disabled={autoUpdateSaving || !statusLoaded}
              onChange={(event) => {
                autoUpdateScheduleTimeDirtyRef.current = true;
                setAutoUpdateScheduleTime(event.target.value);
              }}
            />
          </label>
          <button
            type="button"
            className="ghost-button"
            disabled={autoUpdateSaving || !statusLoaded}
            onClick={() => void saveAutoUpdateSchedule({ time: autoUpdateScheduleTime })}
          >保存时间</button>
        </div>
        <p className="provider-setting-help">后台任务会在每天到达此时间后检查 A 股、美股和外汇；软件在此时间之后启动则立即执行，全天只执行一次。</p>
        <small className="auto-update-setting-status">
          {autoUpdateScheduledEnabled
            ? `当前计划：每天 ${autoUpdateScheduleTime}（系统时间）`
            : "定时检查未开启"}
        </small>
      </article>

      <article className="provider-setting-card">
        <div className="provider-setting-title">
          <div><KeyRound size={17} /><span><strong>Tushare Pro</strong><small>A 股日线数据（不复权）</small></span></div>
          <span className={status.tushare.configured ? "configured" : ""}>
            {statusLoaded ? sourceLabel(status.tushare.source) : "正在读取本机凭证状态…"}
            {statusLoaded && status.tushare.hint ? ` · ${status.tushare.hint}` : ""}
          </span>
        </div>
        <div className="provider-secret-fields single">
          <label>服务密钥
            <input type="password" autoComplete="new-password" value={tushareToken} onChange={(event) => setTushareToken(event.target.value)} placeholder={status.tushare.configured ? "输入新值可替换现有密钥" : "填写 Tushare 服务密钥"} />
          </label>
        </div>
        <p className="provider-setting-help">保留原有逐批日线和维护入口；Tushare daily 返回的是不复权价格。需要复权时，优先选择 BaoStock，或使用已配置的 TdxQuant 复权服务。</p>
        <div className="provider-setting-actions">
          {status.tushare.source === "settings" && <button className="delete-session" onClick={() => clearProvider("tushare")}><Trash2 size={13} />清除本机凭证</button>}
          <button className="primary-button" disabled={saving === "tushare"} onClick={() => saveProvider("tushare")}><Save size={14} />保存 Tushare</button>
        </div>
      </article>

      <article className="provider-setting-card">
        <div className="provider-setting-title">
          <div><KeyRound size={17} /><span><strong>Alpaca</strong><small>美股历史 K 线</small></span></div>
          <span className={status.alpaca.configured ? "configured" : ""}>
            {statusLoaded ? sourceLabel(status.alpaca.source) : "正在读取本机凭证状态…"}
            {statusLoaded && status.alpaca.keyIdHint ? ` · ${status.alpaca.keyIdHint}` : ""}
          </span>
        </div>
        <div className="provider-secret-fields">
          <label>访问密钥 ID
            <input type="password" autoComplete="new-password" value={alpacaKeyId} onChange={(event) => setAlpacaKeyId(event.target.value)} placeholder={status.alpaca.configured ? "输入新值可替换现有凭证" : "填写 Alpaca 访问密钥 ID"} />
          </label>
          <label>访问密钥
            <input type="password" autoComplete="new-password" value={alpacaSecretKey} onChange={(event) => setAlpacaSecretKey(event.target.value)} placeholder={status.alpaca.configured ? "输入新值可替换现有凭证" : "填写 Alpaca 访问密钥"} />
          </label>
        </div>
        <div className="provider-setting-actions">
          {status.alpaca.source === "settings" && <button className="delete-session" onClick={() => clearProvider("alpaca")}><Trash2 size={13} />清除本机凭证</button>}
          <button className="primary-button" disabled={saving === "alpaca"} onClick={() => saveProvider("alpaca")}><Save size={14} />保存 Alpaca</button>
        </div>
      </article>

      <article className="provider-setting-card">
        <div className="provider-setting-title">
          <div><Link2 size={17} /><span><strong>TdxQuant</strong><small>A 股分钟 / 增强数据（可复权）</small></span></div>
          <span className={status.tdxquant.configured ? "configured" : ""}>
            {statusLoaded ? sourceLabel(status.tdxquant.source) : "正在读取本机配置…"}
          </span>
        </div>
        <div className="provider-secret-fields single">
          <label>本地服务地址
            <input value={tdxQuantEndpoint} onChange={(event) => setTdxQuantEndpoint(event.target.value)} placeholder="http://127.0.0.1:17709" />
          </label>
        </div>
        <p className="provider-setting-help">使用前请完成本机行情终端连接。该服务地址支持复权数据，具体口径由服务提供方决定；这里只保存本机地址。</p>
        <div className="provider-setting-actions">
          {status.tdxquant.source === "settings" && <button className="delete-session" onClick={() => clearProvider("tdxquant")}><Trash2 size={13} />清除本机配置</button>}
          <button className="primary-button" disabled={saving === "tdxquant"} onClick={() => saveProvider("tdxquant")}><Save size={14} />保存 TdxQuant</button>
        </div>
      </article>

      <article className="provider-setting-card">
        <div className="provider-setting-title">
          <div><KeyRound size={17} /><span><strong>BaoStock</strong><small>A 股前复权日线（内置免费数据源）</small></span></div>
          <span className={status.baostock.configured ? "configured" : ""}>
            {statusLoaded ? "内置数据源" : "正在读取本机状态…"}
          </span>
        </div>
          <p className="provider-setting-help">BaoStock 是默认 A 股历史日线来源，直接返回前复权价格；需要不复权日线或其他复权口径时，可在高级自定义中选择相应来源。</p>
      </article>

      <article className="provider-setting-card">
        <div className="provider-setting-title">
          <div><Link2 size={17} /><span><strong>Dukascopy CSV</strong><small>外汇与黄金历史基准导入</small></span></div>
          <span className={status.dukascopy.configured ? "configured" : ""}>
            {statusLoaded ? sourceLabel(status.dukascopy.source) : "正在读取本机配置…"}
          </span>
        </div>
        <div className="provider-secret-fields single">
          <label>自定义 CSV 服务地址（可选）
            <input value={dukascopyEndpoint} onChange={(event) => setDukascopyEndpoint(event.target.value)} placeholder="留空即可使用官方内置适配器" />
          </label>
        </div>
        <p className="provider-setting-help">默认即可使用；外汇和黄金的历史、每日增量、缺口修复都走 Dukascopy。需要指定代理时，再填写自定义服务地址。</p>
        <div className="provider-setting-actions">
          {status.dukascopy.source === "settings" && <button className="delete-session" onClick={() => clearProvider("dukascopy")}><Trash2 size={13} />清除本机配置</button>}
          {dukascopyEndpoint.trim() && <button className="primary-button" disabled={saving === "dukascopy"} onClick={() => saveProvider("dukascopy")}><Save size={14} />保存自定义地址</button>}
        </div>
      </article>

      {notice && <div className="status-banner">{notice}</div>}
    </div>
  );
}
