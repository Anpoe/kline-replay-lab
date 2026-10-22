"use client";

import { useEffect, useState } from "react";

/** Visible recovery for Wi-Fi loss; authorization is always enforced by the HTTP host. */
export function MobileSessionGuard() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) return;
    let disposed = false;
    let checking = false;
    const controller = new AbortController();
    const check = async () => {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const response = await fetch("/api/mobile-access/session", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
        if (!response.ok) throw new Error();
        const state = await response.json() as { authorized: boolean };
        if (!disposed && !state.authorized) window.location.replace("/mobile-connect");
        if (!disposed) setOffline(false);
      } catch { if (!disposed) setOffline(true); }
      finally { checking = false; }
    };
    void check();
    const interval = window.setInterval(() => void check(), 10000);
    const onResume = () => void check();
    window.addEventListener("online", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => { disposed = true; controller.abort(); window.clearInterval(interval); window.removeEventListener("online", onResume); document.removeEventListener("visibilitychange", onResume); };
  }, []);
  return offline ? <div className="mobile-connection-error" role="alert">与电脑的连接已中断，请确认电脑开启，并检查 Wi-Fi 或 Tailscale 连接。<button type="button" className="ghost-button" onClick={() => window.location.reload()}>重新连接</button></div> : null;
}
