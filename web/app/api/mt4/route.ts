import { fetchLocalData } from "../../lib/localDataService";

function localRequestError(request: Request) {
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return "请在运行训练营的电脑上连接 MT4";
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return "请从训练营页面操作 MT4";
  const site = request.headers.get("sec-fetch-site");
  if (site && !["same-origin", "none"].includes(site)) return "请从训练营页面操作 MT4";
  if (request.method === "POST" && !origin && request.headers.get("x-kline-mt4") !== "1") return "请从训练营页面操作 MT4";
  return "";
}
async function proxy(path: string, request: Request, init?: RequestInit, config = false) {
  try {
    const token = request.headers.get("x-kline-mt4-session") ?? "";
    if (!/^[a-f0-9]{48}$/.test(token)) return Response.json({ error: "请从本机训练营页面验证 MT4 连接" }, { status: 401 });
    const result = await fetchLocalData(path, { ...init, headers: { ...init?.headers, "x-kline-mt4-session": token } }, 5000);
    if (config && result.ok) return new Response(await result.text(), { headers: {
      "content-type": "text/plain; charset=utf-8", "content-disposition": 'attachment; filename="KLineTradeBridge.set"', "cache-control": "no-store",
    } });
    return Response.json(await result.json(), { status: result.status, headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "MT4 连接服务不可用，请重启训练营控制面板后重试；若仍失败，请更新程序" }, { status: 503 });
  }
}
export async function GET(request: Request) {
  const error = localRequestError(request);
  if (error) return Response.json({ error }, { status: 403 });
  const action = new URL(request.url).searchParams.get("action");
  if (action === "connection") {
    const origin = new URL(process.env.KLINE_DATA_SERVICE_URL ?? "http://127.0.0.1:3100");
    if (!(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) || origin.protocol !== "http:") {
      return Response.json({ error: "MT4 连接必须使用本机数据服务，请恢复本机连接设置" }, { status: 503 });
    }
    return Response.json({ origin: origin.origin }, { headers: { "cache-control": "no-store" } });
  }
  const config = action === "config";
  return proxy(config ? "/mt4/config" : "/mt4/status", request, undefined, config);
}
export async function POST(request: Request) {
  const error = localRequestError(request);
  if (error) return Response.json({ error }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 16384) return Response.json({ error: "MT4 操作内容过大" }, { status: 413 });
  const source = await request.text();
  if (source.length > 16384) return Response.json({ error: "MT4 操作内容过大" }, { status: 413 });
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(source) as Record<string, unknown>; }
  catch { return Response.json({ error: "MT4 操作格式无效" }, { status: 400 }); }
  if (!payload || !["pair", "reset-pairing", "select", "enable", "pause", "command", "resolve"].includes(String(payload.action))) {
    return Response.json({ error: "不支持的 MT4 操作" }, { status: 400 });
  }
  const result = await proxy("/mt4/ui", request, { method: "POST", headers: { "content-type": "application/json" }, body: source });
  // Pairing secrets are distributed only through the configuration download.
  if (["pair", "reset-pairing"].includes(String(payload.action)) && result.ok) {
    const data = await result.json() as Record<string, unknown>;
    delete data.token;
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  }
  return result;
}
