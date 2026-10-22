"use client";

import { SettingsHelp } from "../../components/SettingsHelp";
import { ChevronRight, RefreshCw } from "lucide-react";
import type { TailscaleAccessStatus } from "./mobileAccessContracts";

const states: Record<string, string> = {
  "not-installed": "未安装 Tailscale", "needs-login": "请在 Tailscale 中登录", "needs-approval": "请在 Tailscale 管理页面批准此电脑",
  "not-running": "请打开 Tailscale 并连接", offline: "Tailscale 离线，请检查网络后重新连接",
  "not-configured": "尚未开启远程连接", disabled: "远程连接已关闭", ready: "远程连接可用", preparing: "正在准备远程连接…",
  "needs-consent": "请先完成 HTTPS 授权，再重新开启远程连接",
  "configuration-changed": "远程配置已变更，请重新开启远程连接",
  "port-conflict": "远程端口已被占用，请在 Tailscale 中检查共享后重试",
  "cleanup-needed": "远程访问已关闭，请在 Tailscale 中检查残留共享",
  error: "无法准备远程连接，请更新 Tailscale 并重新检查",
};

export function TailscaleAccessPanel({ state, enabled, disabled, run }: {
  state: TailscaleAccessStatus; enabled: boolean; disabled: boolean; run: (action: string) => Promise<void>;
}) {
  const prerequisite = ["not-installed", "needs-login", "needs-approval", "not-running", "offline"].includes(state.state);
  const openClient = ["needs-login", "needs-approval", "not-running", "offline"].includes(state.state);
  return <div className="mobile-access-remote">
    <div className="mobile-access-remote-status"><span role="status" className={state.state === "ready" ? "active" : ""}>{states[state.state] ?? states.error}</span><SettingsHelp label="Tailscale 连接说明">在电脑和手机上安装 Tailscale，并登录同一个私人网络。电脑保持开启并运行训练营；手机开启 Tailscale 后，可通过流量或其他 Wi-Fi 访问。首次开启时需在 Tailscale 官方页面批准 HTTPS。此功能使用私有共享，保留其他已有共享；切换账号、网络或电脑服务后请重新检查。带设备标签的连接暂不支持。</SettingsHelp></div>
    <div className="mobile-access-actions">
      {state.state === "not-installed" && <a className="primary-button" href="https://tailscale.com/download/windows" target="_blank" rel="noreferrer">安装电脑版</a>}
      {openClient && <button type="button" className="primary-button" disabled={disabled} onClick={() => void run("tailscale-open")}>打开 Tailscale</button>}
      {state.consentUrl && <a className="primary-button" href={state.consentUrl} target="_blank" rel="noreferrer">授权 HTTPS</a>}
      {!prerequisite && state.state !== "ready" && <button type="button" className={state.consentUrl ? "ghost-button" : "primary-button"} disabled={disabled || !enabled || state.state === "preparing"} title={enabled ? "准备私有 HTTPS 地址，并刷新手机配对二维码。" : "请先开启手机访问。"} onClick={() => void run("tailscale-prepare")}>开启远程连接</button>}
      <button type="button" className="ghost-button" disabled={disabled} onClick={() => void run("tailscale-refresh")}><RefreshCw size={13} aria-hidden="true" />重新检测</button>
      {(state.enabled || ["cleanup-needed", "needs-consent"].includes(state.state)) && <button type="button" className="ghost-button" disabled={disabled} onClick={() => {
        if (window.confirm("关闭远程连接？通过 Tailscale 连接的手机将无法继续访问，本地 Wi-Fi 访问和已授权设备会保留。")) void run("tailscale-disable");
      }}>关闭远程连接</button>}
    </div>
    <details className="mobile-access-disclosure"><summary><ChevronRight size={14} aria-hidden="true" />安装与登录</summary><div className="mobile-access-actions">
      {state.state !== "not-installed" && <a className="ghost-button" href="https://tailscale.com/download/windows" target="_blank" rel="noreferrer">安装电脑版</a>}
      <a className="ghost-button" href="https://tailscale.com/download" target="_blank" rel="noreferrer">安装手机版</a>
      {!openClient && state.state !== "not-installed" && <button type="button" className="ghost-button" disabled={disabled} onClick={() => void run("tailscale-open")}>打开 Tailscale</button>}
    </div></details>
  </div>;
}
