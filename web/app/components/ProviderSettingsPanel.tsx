"use client";

import { KeyRound, Link2, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type ProviderState = {
  configured: boolean;
  source: "settings" | "environment" | null;
  hint?: string;
  keyIdHint?: string;
  endpoint?: string;
};

type ProviderSettingsResponse = {
  providers: {
    tushare: ProviderState;
    alpaca: ProviderState;
    tdxquant: ProviderState;
  };
};

const emptyStatus: ProviderSettingsResponse["providers"] = {
  tushare: { configured: false, source: null },
  alpaca: { configured: false, source: null },
  tdxquant: { configured: false, source: null },
};

function sourceLabel(source: ProviderState["source"]) {
  if (source === "settings") return "已保存在本机设置";
  if (source === "environment") return "来自本机环境文件";
  return "尚未配置";
}

export function ProviderSettingsPanel() {
  const [status, setStatus] = useState(emptyStatus);
  const [tushareToken, setTushareToken] = useState("");
  const [alpacaKeyId, setAlpacaKeyId] = useState("");
  const [alpacaSecretKey, setAlpacaSecretKey] = useState("");
  const [tdxQuantEndpoint, setTdxQuantEndpoint] = useState("http://127.0.0.1:17709");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState<"" | "tushare" | "alpaca" | "tdxquant">("");
  const [statusLoaded, setStatusLoaded] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/provider-settings", { cache: "no-store" });
      if (!response.ok) return false;
      const data = await response.json() as ProviderSettingsResponse;
      setStatus(data.providers);
      setStatusLoaded(true);
      if (data.providers.tdxquant.endpoint) setTdxQuantEndpoint(data.providers.tdxquant.endpoint);
      return true;
    } catch {
      setStatusLoaded(false);
      return false;
    }
  }, []);

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

  const saveProvider = async (provider: "tushare" | "alpaca" | "tdxquant") => {
    setSaving(provider);
    setNotice("");
    try {
      const response = await fetch("/api/provider-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(provider === "tushare"
          ? { provider, tushareToken }
          : provider === "alpaca"
            ? { provider, alpacaKeyId, alpacaSecretKey }
            : { provider, tdxQuantEndpoint }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      setTushareToken("");
      setAlpacaKeyId("");
      setAlpacaSecretKey("");
      await loadStatus();
      window.dispatchEvent(new Event("provider-settings-updated"));
      setNotice(provider === "tdxquant"
        ? "TdxQuant 本地端点已保存。使用分钟数据时仍需启动并登录支持 TQ 的通达信客户端。"
        : `${provider === "alpaca" ? "Alpaca" : "Tushare"} 凭证已保存在本机。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving("");
    }
  };

  const clearProvider = async (provider: "tushare" | "alpaca" | "tdxquant") => {
    const label = provider === "alpaca" ? "Alpaca" : provider === "tushare" ? "Tushare" : "TdxQuant";
    if (!window.confirm(`清除本机保存的 ${label} 配置？`)) return;
    const response = await fetch(`/api/provider-settings?provider=${provider}`, { method: "DELETE" });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setNotice(result.error ?? "清除失败");
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

      {notice && <div className="status-banner">{notice}</div>}
    </div>
  );
}
