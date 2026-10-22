"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronRight, Copy, Globe, RefreshCw, Smartphone, Wifi } from "lucide-react";
import Image from "next/image";
import { SettingsHelp } from "../../components/SettingsHelp";
import type { MobileAccessStatus } from "./mobileAccessContracts";
import { TailscaleAccessPanel } from "./TailscaleAccessPanel";

export function MobileAccessPanel() {
  const [state, setState] = useState<MobileAccessStatus | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [remote, setRemote] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState("");
  const [mode, setMode] = useState<"lan" | "tailscale">("lan");
  const connectionId = useId();
  const mounted = useRef(false);
  const acting = useRef(false);
  const sequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (acting.current) return;
    const ticket = ++sequence.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const response = await fetch("/api/mobile-access", { cache: "no-store", signal: controller.signal });
      if (response.status === 403) {
        if (mounted.current && ticket === sequence.current) { setRemote(true); setLoadError(""); }
        return;
      }
      const body = await response.json() as MobileAccessStatus & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "请重启控制面板中的服务后重试。");
      if (mounted.current && ticket === sequence.current) { setState(body); setConnected(true); setLoadError(""); }
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (mounted.current && ticket === sequence.current) { setConnected(false); setLoadError(failure instanceof Error && failure.message !== "Failed to fetch" ? failure.message : "无法读取手机连接状态，请确认电脑服务运行后重试。"); }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 3000);
    return () => { mounted.current = false; activeRequest.current?.abort(); window.clearTimeout(initial); window.clearInterval(timer); };
  }, [refresh]);

  const run = async (action: string, extra: Record<string, string> = {}) => {
    if (!state || acting.current) return;
    acting.current = true;
    ++sequence.current;
    activeRequest.current?.abort();
    setBusy(true); setError(""); setLoadError(""); setNotice("");
    try {
      const response = await fetch("/api/mobile-access", { method: "POST", headers: { "Content-Type": "application/json", "x-kline-mobile-admin": state.adminToken }, body: JSON.stringify({ action, ...extra }) });
      const body = await response.json() as MobileAccessStatus & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "连接操作未完成，请重新检查后重试。");
      if (mounted.current) {
        setState(body); setConnected(true);
        if (action === "tailscale-prepare" && body.tailscale?.state === "ready") setMode("tailscale");
        if (action === "firewall") setNotice("本地网络已放行。请使用专用 Wi-Fi，在手机上重新连接。");
      }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error && failure.message !== "Failed to fetch" ? failure.message : "连接操作未完成，请检查电脑服务后重试。");
    } finally {
      acting.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const addresses = state?.addresses.filter(item => mode === "tailscale" ? item.address === "tailscale" : item.address !== "tailscale") ?? [];
  const selected = addresses.find(item => item.address === address) ?? addresses[0];
  const disabled = busy || !connected;
  return <section className="settings-rule settings-group mobile-access-panel" aria-labelledby="settings-group-mobile-access" data-settings-group="mobile-access">
    <header className="mobile-access-header">
      <div className="mobile-access-heading"><h4 id="settings-group-mobile-access"><Smartphone size={15} aria-hidden="true" />手机访问</h4>
        {!remote && <span className={`mobile-access-status${state?.enabled ? " active" : ""}`} role="status">{busy ? "处理中…" : state ? state.enabled ? "已开启" : "未开启" : (error || loadError) ? "连接不可用" : "检查中…"}</span>}
        <SettingsHelp label="手机访问说明">选择同一 Wi-Fi 或跨网络连接，电脑需保持开启并运行训练营。配对二维码 5 分钟内有效且只能使用一次，授权保留 30 天。此处操作即时保存；手机与电脑使用同一份已保存数据，当前未保存的训练不会自动接力。</SettingsHelp>
      </div>
      {!remote && <button type="button" className={state?.enabled ? "ghost-button" : "primary-button"} disabled={disabled || !state} onClick={() => {
        if (state?.enabled && !window.confirm("关闭手机访问？所有手机将暂时无法访问，已保存的设备授权会保留。")) return;
        void run(state?.enabled ? "disable" : "enable");
      }}>{state?.enabled ? "关闭访问" : "开启手机访问"}</button>}
    </header>
    {remote ? <p className="settings-consequence">请在电脑的本机页面开启和管理手机访问。</p> : <>
      {state?.storageError && <p className="task-error" role="alert">{state.storageError}</p>}
      {state?.enabled && <>
        {state.pending.length > 0 && <div className="mobile-access-pending"><strong>待确认 · {state.pending.length}</strong>{state.pending.map((request) => <div className="mobile-access-device" key={request.id}><div><strong>{request.name}</strong><span>核对码 <b>{request.number}</b></span></div><div className="mobile-access-actions"><button type="button" className="primary-button" disabled={disabled} onClick={() => {
          if (window.confirm(`允许“${request.name}”（核对码 ${request.number}）连接？请确认手机显示相同核对码。允许后可读取和修改本机数据，并使用已启用的 MT4 交易功能。`)) void run("approve", { id: request.id, number: request.number });
        }}>允许连接</button><button type="button" className="ghost-button" disabled={disabled} onClick={() => void run("deny", { id: request.id })}>拒绝</button></div></div>)}</div>}
        <div className="mobile-access-modes" role="tablist" aria-label="连接方式">
          {(["lan", "tailscale"] as const).map((item, index) => <button type="button" role="tab" id={`${connectionId}-${item}`} aria-controls={`${connectionId}-panel`} aria-selected={mode === item} tabIndex={mode === item ? 0 : -1} key={item} onClick={() => setMode(item)} onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
            setMode(next === 0 ? "lan" : "tailscale");
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
          }}>{item === "lan" ? <Wifi size={14} aria-hidden="true" /> : <Globe size={14} aria-hidden="true" />}{item === "lan" ? "同一 Wi-Fi" : "跨网络"}</button>)}
        </div>
        <div className="mobile-access-connection" role="tabpanel" id={`${connectionId}-panel`} aria-labelledby={`${connectionId}-${mode}`}>
        {mode === "tailscale" && (state.tailscale ? <TailscaleAccessPanel state={state.tailscale} enabled={state.enabled} disabled={disabled} run={run} /> : <p className="task-error" role="alert">远程连接状态不可用，请重新检查。<button type="button" className="ghost-button" disabled={busy} onClick={() => void refresh()}>重新检查</button></p>)}
        {selected ? <div className="mobile-access-pairing">
          <div className={`mobile-access-qr${state.challenge ? "" : " empty"}`}>{state.challenge ? <Image unoptimized width={176} height={176} alt="手机配对二维码" src={`/api/mobile-access/qr?address=${encodeURIComponent(selected.address)}&code=${encodeURIComponent(state.challenge.code)}`} /> : <span role="status">请刷新二维码</span>}</div>
          <div className="mobile-access-details">
            <label>连接地址<select aria-label="手机连接地址" value={selected.address} onChange={(event) => setAddress(event.target.value)}>{addresses.map((item) => <option key={item.address} value={item.address}>{item.address === "tailscale" ? "Tailscale" : `${item.name} · ${item.address}`}</option>)}</select></label>
            <output className="mobile-access-url">{selected.url.split("#")[0]}</output>
            <span role="status">{state.challenge ? `有效至 ${new Date(state.challenge.expiresAt).toLocaleTimeString("zh-CN", { hour12: false })}` : "二维码已使用或过期"}</span>
            <div className="mobile-access-actions"><button type="button" className="ghost-button" disabled={disabled} onClick={() => void run("rotate")}><RefreshCw size={13} aria-hidden="true" />刷新二维码</button><button type="button" className="ghost-button" disabled={disabled || !state.challenge} onClick={() => {
              void (async () => { try { await navigator.clipboard.writeText(selected.url); setNotice("配对链接已复制，请在手机浏览器中打开。"); } catch { setNotice("请选中下方配对链接，复制到手机浏览器。"); } })();
            }}><Copy size={13} aria-hidden="true" />复制链接</button></div>
            {notice.includes("选中") && <input aria-label="配对链接" readOnly value={selected.url} onFocus={(event) => event.target.select()} />}
          </div>
        </div> : mode === "lan" ? <p className="task-error" role="alert">没有找到可用的本地地址，请连接 Wi-Fi 后重新检查。<button type="button" className="ghost-button" disabled={busy} onClick={() => void refresh()}>重新检查</button></p> : null}
        {mode === "lan" && <details className="mobile-access-disclosure"><summary><ChevronRight size={14} aria-hidden="true" />连接帮助</summary><div className="mobile-access-actions"><button type="button" className="ghost-button" disabled={busy} onClick={() => void refresh()}>重新检查</button>{state.firewallAvailable && <button type="button" className="ghost-button" disabled={disabled} onClick={() => void run("firewall")}>允许本地网络连接</button>}<SettingsHelp label="手机连接故障帮助">确认手机与电脑连接同一可信 Wi-Fi，并将 Windows 当前网络设为专用网络，再选择“允许本地网络连接”并接受系统授权。此操作只放行当前程序在专用网络中的本地子网连接。访客网络或路由器的设备隔离可能阻止连接；可切换普通家庭 Wi-Fi。切换网络后重新检查地址并扫码。</SettingsHelp></div></details>}
        </div>
      </>}
      {state && <details className="mobile-access-disclosure mobile-access-devices"><summary><ChevronRight size={14} aria-hidden="true" />已授权设备<span className="mobile-access-count">{state.devices.length}</span></summary><div>{state.devices.length === 0 ? <span className="mobile-access-empty">尚未配对设备</span> : state.devices.map((device) => <div className="mobile-access-device" key={device.id}><div><strong>{device.name}</strong><span>{device.expired ? "授权已过期，请重新配对" : `授权至 ${new Date(device.expiresAt).toLocaleDateString("zh-CN")}`}</span></div><button type="button" className="danger-button" disabled={disabled} onClick={() => { if (window.confirm(`撤销“${device.name}”的访问授权？手机将无法继续访问，已保存数据会保留。`)) void run("revoke", { id: device.id }); }}>撤销授权</button></div>)}</div></details>}
    </>}
    {notice && <p className="settings-consequence" role="status">{notice}</p>}
    {(error || loadError) && <div className="task-error" role="alert">{error || loadError}<button type="button" className="ghost-button" disabled={busy} onClick={() => { setError(""); void refresh(); }}>重试</button></div>}
  </section>;
}
