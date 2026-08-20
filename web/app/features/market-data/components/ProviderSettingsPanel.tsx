"use client";

import { KeyRound, Link2, RefreshCw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createMarketDataGateway } from "../marketDataGateway";

type ProviderState = {
  configured: boolean;
  source: "settings" | "environment" | "builtin" | null;
  hint?: string;
  keyIdHint?: string;
  endpoint?: string;
};

type ProviderSettingsResponse = {
  providers: {
    tushare: ProviderState;
    alpaca: ProviderState;
    tdxquant: ProviderState;
    twelvedata: ProviderState;
    dukascopy: ProviderState;
  };
  autoUpdate?: {
    enabled: boolean;
    lastCheckDate: string | null;
    lastFinishedAt: string | null;
    lastStatus: "idle" | "running" | "completed" | "partial" | "failed";
    lastMessage: string;
  };
};

const emptyStatus: ProviderSettingsResponse["providers"] = {
  tushare: { configured: false, source: null },
  alpaca: { configured: false, source: null },
  tdxquant: { configured: false, source: null },
  twelvedata: { configured: false, source: null },
  dukascopy: { configured: false, source: null },
};

function sourceLabel(source: ProviderState["source"]) {
  if (source === "settings") return "已保存在本机设置";
  if (source === "environment") return "来自本机环境文件";
  if (source === "builtin") return "已启用官方内置适配器";
  return "尚未配置";
}

export function ProviderSettingsPanel() {
  const [status, setStatus] = useState(emptyStatus);
  const [tushareToken, setTushareToken] = useState("");
  const [alpacaKeyId, setAlpacaKeyId] = useState("");
  const [alpacaSecretKey, setAlpacaSecretKey] = useState("");
  const [tdxQuantEndpoint, setTdxQuantEndpoint] = useState("http://127.0.0.1:17709");
  const [twelveDataApiKey, setTwelveDataApiKey] = useState("");
  const [dukascopyEndpoint, setDukascopyEndpoint] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState<"" | "tushare" | "alpaca" | "tdxquant" | "twelvedata" | "dukascopy">("");
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);
  const [autoUpdateStatus, setAutoUpdateStatus] = useState<ProviderSettingsResponse["autoUpdate"]>();
  const [autoUpdateSaving, setAutoUpdateSaving] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const marketDataGateway = useMemo(
    () => createMarketDataGateway((input, init) => fetch(input, init)),
    [],
  );

  const loadStatus = useCallback(async () => {
    try {
      const data = await marketDataGateway.loadProviderSettings<ProviderSettingsResponse>();
      setStatus(data.providers);
      setAutoUpdateEnabled(Boolean(data.autoUpdate?.enabled));
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
    const refreshAutoUpdateStatus = () => {
      void loadStatus();
    };
    window.addEventListener("data-auto-update-updated", refreshAutoUpdateStatus);
    return () => window.removeEventListener("data-auto-update-updated", refreshAutoUpdateStatus);
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

  const saveProvider = async (provider: "tushare" | "alpaca" | "tdxquant" | "twelvedata" | "dukascopy") => {
    setSaving(provider);
    setNotice("");
    try {
      await marketDataGateway.saveProviderSettings<{ error?: string }>(provider === "tushare"
        ? { provider, tushareToken }
        : provider === "alpaca"
          ? { provider, alpacaKeyId, alpacaSecretKey }
        : provider === "tdxquant"
          ? { provider, tdxQuantEndpoint }
          : provider === "twelvedata"
            ? { provider, twelveDataApiKey }
            : { provider, dukascopyEndpoint });
      setTushareToken("");
      setAlpacaKeyId("");
      setAlpacaSecretKey("");
      setTwelveDataApiKey("");
      await loadStatus();
      window.dispatchEvent(new Event("provider-settings-updated"));
      setNotice(provider === "tdxquant"
        ? "TdxQuant 本地端点已保存。使用分钟数据时仍需启动并登录支持 TQ 的通达信客户端。"
        : provider === "twelvedata"
          ? "Twelve Data API Key 已保存在本机。"
          : provider === "dukascopy"
            ? "Dukascopy 自定义 CSV 地址已保存在本机。"
            : `${provider === "alpaca" ? "Alpaca" : "Tushare"} 凭证已保存在本机。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving("");
    }
  };

  const clearProvider = async (provider: "tushare" | "alpaca" | "tdxquant" | "twelvedata" | "dukascopy") => {
    const label = provider === "alpaca" ? "Alpaca" : provider === "tushare" ? "Tushare" : provider === "tdxquant" ? "TdxQuant" : provider === "twelvedata" ? "Twelve Data" : "Dukascopy";
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
        <span>凭证只保存在这台电脑的本地数据库；界面不会回显完整内容，也不会写入 Git。</span>
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

      <article className="provider-setting-card">
        <div className="provider-setting-title">
          <div><KeyRound size={17} /><span><strong>Alpaca</strong><small>美股历史 K 线</small></span></div>
          <span className={status.alpaca.configured ? "configured" : ""}>
            {statusLoaded ? sourceLabel(status.alpaca.source) : "正在读取本机凭证状态…"}
            {statusLoaded && status.alpaca.keyIdHint ? ` · ${status.alpaca.keyIdHint}` : ""}
          </span>
        </div>
        <div className="provider-secret-fields">
          <label>API Key ID
            <input type="password" autoComplete="new-password" value={alpacaKeyId} onChange={(event) => setAlpacaKeyId(event.target.value)} placeholder={status.alpaca.configured ? "输入新值可替换现有凭证" : "填写 Alpaca API Key ID"} />
          </label>
          <label>Secret Key
            <input type="password" autoComplete="new-password" value={alpacaSecretKey} onChange={(event) => setAlpacaSecretKey(event.target.value)} placeholder={status.alpaca.configured ? "输入新值可替换现有凭证" : "填写 Alpaca Secret Key"} />
          </label>
        </div>
        <div className="provider-setting-actions">
          {status.alpaca.source === "settings" && <button className="delete-session" onClick={() => clearProvider("alpaca")}><Trash2 size={13} />清除本机凭证</button>}
          <button className="primary-button" disabled={saving === "alpaca"} onClick={() => saveProvider("alpaca")}><Save size={14} />保存 Alpaca</button>
        </div>
      </article>

      <article className="provider-setting-card">
        <div className="provider-setting-title">
          <div><Link2 size={17} /><span><strong>TdxQuant</strong><small>A 股 5m / 1h 与增强历史数据</small></span></div>
          <span className={status.tdxquant.configured ? "configured" : ""}>
            {statusLoaded ? sourceLabel(status.tdxquant.source) : "正在读取本机配置…"}
          </span>
        </div>
        <div className="provider-secret-fields single">
          <label>本地 HTTP 端点
            <input value={tdxQuantEndpoint} onChange={(event) => setTdxQuantEndpoint(event.target.value)} placeholder="http://127.0.0.1:17709" />
          </label>
        </div>
        <p className="provider-setting-help">不需要券商资金账号，但使用时必须启动并登录支持 TQ 的通达信客户端。这里只允许保存本机地址。</p>
        <div className="provider-setting-actions">
          {status.tdxquant.source === "settings" && <button className="delete-session" onClick={() => clearProvider("tdxquant")}><Trash2 size={13} />清除本机配置</button>}
          <button className="primary-button" disabled={saving === "tdxquant"} onClick={() => saveProvider("tdxquant")}><Save size={14} />保存 TdxQuant</button>
        </div>
      </article>

      <article className="provider-setting-card">
        <div className="provider-setting-title">
          <div><KeyRound size={17} /><span><strong>Tushare Pro</strong><small>A 股历史 K 线</small></span></div>
          <span className={status.tushare.configured ? "configured" : ""}>
            {statusLoaded ? sourceLabel(status.tushare.source) : "正在读取本机凭证状态…"}
            {statusLoaded && status.tushare.hint ? ` · ${status.tushare.hint}` : ""}
          </span>
        </div>
        <div className="provider-secret-fields single">
          <label>Token
            <input type="password" autoComplete="new-password" value={tushareToken} onChange={(event) => setTushareToken(event.target.value)} placeholder={status.tushare.configured ? "输入新值可替换现有 Token" : "填写 Tushare Token"} />
          </label>
        </div>
        <p className="provider-setting-help">5m / 1h 历史分钟线仍取决于 Tushare 账户的数据权限。</p>
        <div className="provider-setting-actions">
          {status.tushare.source === "settings" && <button className="delete-session" onClick={() => clearProvider("tushare")}><Trash2 size={13} />清除本机凭证</button>}
          <button className="primary-button" disabled={saving === "tushare"} onClick={() => saveProvider("tushare")}><Save size={14} />保存 Tushare</button>
        </div>
      </article>

      <article className="provider-setting-card">
        <div className="provider-setting-title">
          <div><KeyRound size={17} /><span><strong>Twelve Data REST</strong><small>外汇 1m 增量更新</small></span></div>
          <span className={status.twelvedata.configured ? "configured" : ""}>
            {statusLoaded ? sourceLabel(status.twelvedata.source) : "正在读取本机凭证状态…"}
            {statusLoaded && status.twelvedata.hint ? ` · ${status.twelvedata.hint}` : ""}
          </span>
        </div>
        <div className="provider-secret-fields single">
          <label>API Key
            <input type="password" autoComplete="new-password" value={twelveDataApiKey} onChange={(event) => setTwelveDataApiKey(event.target.value)} placeholder={status.twelvedata.configured ? "输入新值可替换现有凭证" : "填写 Twelve Data API Key"} />
          </label>
        </div>
        <p className="provider-setting-help">密钥只在服务端请求 Twelve Data，前端不会把完整密钥回显。增量更新写入已经收盘的 M1，并在本机聚合 5m / 1h / 1d / 1w。</p>
        <div className="provider-setting-actions">
          {status.twelvedata.source === "settings" && <button className="delete-session" onClick={() => clearProvider("twelvedata")}><Trash2 size={13} />清除本机凭证</button>}
          <button className="primary-button" disabled={saving === "twelvedata"} onClick={() => saveProvider("twelvedata")}><Save size={14} />保存 Twelve Data</button>
        </div>
      </article>

      <article className="provider-setting-card">
        <div className="provider-setting-title">
          <div><Link2 size={17} /><span><strong>Dukascopy CSV</strong><small>外汇历史基准导入</small></span></div>
          <span className={status.dukascopy.configured ? "configured" : ""}>
            {statusLoaded ? sourceLabel(status.dukascopy.source) : "正在读取本机配置…"}
          </span>
        </div>
        <div className="provider-secret-fields single">
          <label>自定义 CSV 服务地址（可选）
            <input value={dukascopyEndpoint} onChange={(event) => setDukascopyEndpoint(event.target.value)} placeholder="留空即可使用官方内置适配器" />
          </label>
        </div>
        <p className="provider-setting-help">系统已内置官方 Dukascopy 适配器，无需填写地址。只有在你要覆盖官方服务时，才填写一个直接返回 CSV 并接受 instrument、start、end、timeframe 参数的自定义地址。</p>
        <div className="provider-setting-actions">
          {status.dukascopy.source === "settings" && <button className="delete-session" onClick={() => clearProvider("dukascopy")}><Trash2 size={13} />清除本机配置</button>}
          {dukascopyEndpoint.trim() && <button className="primary-button" disabled={saving === "dukascopy"} onClick={() => saveProvider("dukascopy")}><Save size={14} />保存自定义地址</button>}
        </div>
      </article>

      {notice && <div className="status-banner">{notice}</div>}
    </div>
  );
}
