import { Mt4Error } from "./mt4-bridge.mjs";
import { ArchiveError } from "./mt4-archive.mjs";
import http from "node:http";

// MT4 WebRequest builds that reject custom ports use this loopback-only HTTP receiver.
// It runs in the existing data-service process, shares the same bridge, and has no browser/account endpoints.
export async function startMt4TerminalServer(bridge, { port = 80, startupError = null } = {}) {
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (!["/mt4/terminal", "/mt4/execution"].includes(pathname) || request.method !== "POST") {
      response.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ error: "不支持的 MT4 请求" })); return;
    }
    await handleMt4Request(bridge, request, response, startupError);
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
    });
    bridge.transportError = "";
    return server;
  } catch (error) {
    bridge.transportError = error.code === "EADDRINUSE"
      ? "MT4 本机连接入口被其他程序占用，请先停止其他本机网页服务，再重启训练营控制面板"
      : "MT4 本机连接入口无法启动，请检查程序运行权限后重启控制面板";
    throw error;
  }
}

export function isMt4LoopbackHost(host) {
  try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(`http://${host}`).hostname); } catch { return false; }
}
export async function handleMt4Request(bridge, request, response, startupError = null) {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (!pathname.startsWith("/mt4/")) return false;
  const send = (status, body, contentType = "application/json; charset=utf-8") => {
    response.writeHead(status, { "content-type": contentType, "cache-control": "no-store", "x-content-type-options": "nosniff" });
    response.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  try {
    const remote = request.socket.remoteAddress;
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote) || !isMt4LoopbackHost(request.headers.host)) {
      throw new Mt4Error("MT4 连接仅允许本机程序访问", 403);
    }
    if (startupError) throw new Mt4Error("MT4 连接记录不可用，请恢复程序数据备份后重启控制面板；训练功能仍可使用", 503);
    if (pathname === "/mt4/browser-session" && request.method === "GET") {
      const origin = request.headers.origin;
      const port = process.env.KLINE_MT4_WEB_PORT ?? "3101";
      if (![ `http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}` ].includes(origin)) throw new Mt4Error("请从本机训练营页面连接 MT4", 403);
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("vary", "Origin");
      send(200, { token: bridge.uiSession }); return true;
    }
    if (request.headers.origin || request.headers["sec-fetch-site"]) throw new Mt4Error("MT4 连接仅允许本机程序访问", 403);
    if (!["/mt4/terminal", "/mt4/execution"].includes(pathname) && request.headers["x-kline-mt4-session"] !== bridge.uiSession) throw new Mt4Error("本机连接会话已失效，请重新验证连接", 401);
    if (pathname === '/mt4/archive') {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET') {
        const key = url.searchParams.get('accountKey') ?? '', symbol = url.searchParams.get('symbol') ?? '', tf = Number(url.searchParams.get('timeframe') ?? 5), action = url.searchParams.get('action');
        if (action && !['accounts','analysis','plans','trade','backup','list','chart','bars'].includes(action)) throw new Mt4Error('不支持的档案读取');
        if (action === 'plans') {
          send(200, bridge.archive.decisionPlans({ accountKey: key, symbol, offset: url.searchParams.get('offset') ?? 0, limit: url.searchParams.get('limit') ?? 100 }));
          return true;
        }
        if (action === 'bars') {
          send(200, bridge.archive.bars({ accountKey: key, symbol, timeframe: tf, before: url.searchParams.get('before') ?? 0, after: url.searchParams.get('after') ?? 0, focus: url.searchParams.get('focus') ?? 0, limit: url.searchParams.get('limit') ?? 1000 }));
          return true;
        }
        const filters={accountKey:key,symbol,from:url.searchParams.get('from')??'',to:url.searchParams.get('to')??''};
        send(200, action === 'accounts' ? { accounts: bridge.archive.accounts() } : action === 'analysis' ? bridge.archive.analysis(key, symbol, tf, url.searchParams.get('scope') ?? 'chart') : action === 'trade' ? bridge.archive.trade(key, symbol, Number(url.searchParams.get('ticket')), tf, Number(url.searchParams.get('focus') ?? 0)) : action === 'chart' ? bridge.archive.chart({...filters,timeframe:tf}) : action === 'backup' ? bridge.archive.backup() : bridge.archive.list({...filters,page:Number(url.searchParams.get('page')??0),chartSymbol:url.searchParams.get('chartSymbol')??''}));
      } else if (request.method === 'POST') {
        const chunks = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 128 * 1024 * 1024) throw new Mt4Error('备份或绘图内容过大，请分账户管理档案', 413); chunks.push(chunk); }
        let payload; try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Mt4Error('档案内容格式无效'); }
        if (!payload || Array.isArray(payload) || typeof payload !== 'object' || !['save-analysis','restore','rescan','chart'].includes(payload.action)) throw new Mt4Error('不支持的档案操作');
        send(200, await bridge.run(() => bridge.archiveRequest(payload)));
      } else send(405, { error: '不支持的档案操作' });
      return true;
    }
    if (pathname === "/mt4/status" && request.method === "GET") send(200, bridge.status());
    else if (pathname === "/mt4/config" && request.method === "GET") {
      if (!bridge.state.token) throw new Mt4Error("请先生成 MT4 连接配置", 409);
      if (bridge.transportError) throw new Mt4Error(bridge.transportError, 503);
      send(200, `InpBridgeUrl=http://127.0.0.1/mt4/terminal\r\nInpPairToken=${bridge.state.token}\r\nInpAllowReal=false\r\nInpPollSeconds=1\r\n`, "text/plain; charset=utf-8");
    } else if (request.method === "POST" && ["/mt4/ui", "/mt4/terminal", "/mt4/execution"].includes(pathname)) {
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length; if (size > 1024 * 1024) throw new Mt4Error("MT4 数据过大", 413); chunks.push(chunk);
      }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Mt4Error("MT4 数据格式无效"); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Mt4Error("MT4 请求无效");
      send(200, ["/mt4/terminal", "/mt4/execution"].includes(pathname)
        ? await bridge.terminal(String(request.headers.authorization ?? "").replace(/^Bearer /, ""), payload, { fast: pathname === "/mt4/execution" })
        : await bridge.ui(payload));
    } else send(404, { error: "不支持的 MT4 请求" });
  } catch (error) {
    send(error instanceof Mt4Error || error instanceof ArchiveError ? error.status : 503, { error: error instanceof Mt4Error || error instanceof ArchiveError ? error.message : "MT4 连接记录未能保存，请检查本机存储后重试" });
  }
  return true;
}
