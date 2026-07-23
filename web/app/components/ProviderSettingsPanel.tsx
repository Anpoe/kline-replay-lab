"use client";

import { KeyRound, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type ProviderState = {
  configured: boolean;
  source: "settings" | "environment" | null;
  hint?: string;
  keyIdHint?: string;
};

type ProviderSettingsResponse = {
  providers: {
    tushare: ProviderState;
    alpaca: ProviderState;
  };
};

const emptyStatus: ProviderSettingsResponse["providers"] = {
  tushare: { configured: false, source: null },
  alpaca: { configured: false, source: null },
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
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState<"" | "tushare" | "alpaca">("");

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/provider-settings");
    if (!response.ok) return;
    const data = await response.json() as ProviderSettingsResponse;
    setStatus(data.providers);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadStatus]);

  const saveProvider = async (provider: "tushare" | "alpaca") => {
    setSaving(provider);
    setNotice("");
    try {
      const response = await fetch("/api/provider-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(provider === "tushare"
          ? { provider, tushareToken }
          : { provider, alpacaKeyId, alpacaSecretKey }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      setTushareToken("");
      setAlpacaKeyId("");
      setAlpacaSecretKey("");
      await loadStatus();
      window.dispatchEvent(new Event("provider-settings-updated"));
      setNotice(`${provider === "alpaca" ? "Alpaca" : "Tushare"} 凭证已保存在本机。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving("");
    }
  };

  const clearProvider = async (provider: "tushare" | "alpaca") => {
    if (!window.confirm(`清除本机保存的 ${provider === "alpaca" ? "Alpaca" : "Tushare"} 凭证？`)) return;
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
            {sourceLabel(status.alpaca.source)}{status.alpaca.keyIdHint ? ` · ${status.alpaca.keyIdHint}` : ""}
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
          <div><KeyRound size={17} /><span><strong>Tushare Pro</strong><small>A 股历史 K 线</small></span></div>
          <span className={status.tushare.configured ? "configured" : ""}>
            {sourceLabel(status.tushare.source)}{status.tushare.hint ? ` · ${status.tushare.hint}` : ""}
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
