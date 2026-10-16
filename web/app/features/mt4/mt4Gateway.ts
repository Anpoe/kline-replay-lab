import type { Mt4Status } from "./mt4Contracts";

export class Mt4RequestError extends Error {
  constructor(message: string, public readonly status: number, public readonly definite = status < 500) { super(message); }
}

let session = "";
let sessionRequest: Promise<string> | null = null;
async function localSession(signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (session) return session;
  if (!sessionRequest) sessionRequest = (async () => {
    const signal = AbortSignal.timeout(5000);
    try {
      const connection = await fetch("/api/mt4?action=connection", { cache: "no-store", signal });
      const data = await connection.json() as { origin?: string; error?: string };
      if (!connection.ok || !data.origin) throw new Error(data.error ?? "MT4 连接设置不可用");
      const origin = new URL(data.origin);
      if (origin.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) throw new Error("请恢复 MT4 本机连接设置");
      const response = await fetch(`${origin.origin}/mt4/browser-session`, { credentials: "omit", cache: "no-store", signal });
      const result = await response.json() as { token?: string; error?: string };
      if (!response.ok || !result.token || !/^[a-f0-9]{48}$/.test(result.token)) throw new Error(result.error ?? "MT4 连接服务版本不支持，请重启控制面板或更新程序");
      session = result.token; return session;
    } catch (error) {
      const timedOut = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
      throw new Mt4RequestError(timedOut ? "MT4 连接等待超时，请重新读取" : error instanceof Error && error.message !== "Failed to fetch" ? error.message : "无法连接本机 MT4 服务，请重启训练营控制面板后重试", 503, true);
    } finally { sessionRequest = null; }
  })();
  return sessionRequest;
}

export async function requestMt4(payload?: Record<string, unknown>, signal?: AbortSignal): Promise<Mt4Status> {
  const body = payload ? JSON.stringify(payload) : undefined;
  const command = payload?.action === "command";
  let response: Response | undefined;
  let uncertain = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    let token: string;
    try { token = await localSession(signal); signal?.throwIfAborted(); }
    catch (e) {
      if (uncertain) throw new Mt4RequestError("提交结果尚未确认，请重新读取并核对执行回报", 0, false);
      throw e;
    }
    try {
      response = await fetch("/api/mt4", { method: payload ? "POST" : "GET", cache: "no-store", signal,
        headers: { "x-kline-mt4-session": token, ...(payload ? { "content-type": "application/json", "x-kline-mt4": "1" } : {}) }, ...(body ? { body } : {}) });
    } catch {
      uncertain = command;
      if (command && attempt === 0 && !signal?.aborted) continue;
      throw new Mt4RequestError(command ? "提交结果尚未确认，请先重新读取或核对提交结果" : "MT4 连接服务未响应，请重新读取", 0, false);
    }
    if (response.status === 401) {
      session = "";
      if (command && attempt === 0 && !signal?.aborted) continue;
    }
    break;
  }
  if (!response) throw new Mt4RequestError("提交结果尚未确认，请核对执行回报", 0, false);
  let data: Mt4Status & { error?: string };
  try { data = await response.json() as Mt4Status & { error?: string }; }
  catch { throw new Mt4RequestError("MT4 连接响应异常，请重新读取并核对执行结果", 502, false); }
  if (!response.ok) throw new Mt4RequestError(data.error ?? "MT4 连接失败，请重试连接", response.status, !uncertain && response.status < 500);
  if (data.protocolVersion !== 1) throw new Error("MT4 连接版本不匹配，请更新程序并重新下载连接文件");
  return data;
}

export async function downloadMt4Config() {
  const signal = AbortSignal.timeout(7000);
  const response = await fetch("/api/mt4?action=config", { cache: "no-store", signal, headers: { "x-kline-mt4-session": await localSession(signal) } });
  if (response.status === 401) session = "";
  if (!response.ok) {
    const result = await response.json() as { error?: string };
    throw new Error(result.error ?? "连接配置下载失败，请重新验证连接");
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "KLineTradeBridge.set";
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function requestMt4Archive<T>(query: Record<string, string | number> = {}, payload?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const token = await localSession(signal);
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  const response = await fetch(`/api/mt4/archive?${params}`, { method: payload ? 'POST' : 'GET', cache: 'no-store', signal,
    headers: { 'x-kline-mt4-session': token, ...(payload ? { 'content-type': 'application/json', 'x-kline-mt4': '1' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  if (response.status === 401) session = '';
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Mt4RequestError(data.error ?? '档案未能读取或保存，请重试', response.status);
  return data;
}
