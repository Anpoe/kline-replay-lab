import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const ORIGIN = "https://jetta.dukascopy.com";
const WIDGET = "https://widgets.dukascopy.com/en/historical-data-export";
const PROFILE_PREFIX = "kline-dukascopy-";

function invalidPath() { const error = new Error("行情请求无效，仅支持官方品种与单日分钟行情"); error.status = 400; return error; }

export function dukascopyRequestUrl(value) {
  if (typeof value !== "string") throw invalidPath();
  const instrument = "[A-Z0-9_-]{1,40}(?:%2F[A-Z0-9_-]{1,40})?";
  if (new RegExp(`^/v1/instruments/${instrument}$`).test(value)) return ORIGIN + value;
  const match = value.match(new RegExp(`^/v1/candles/minute/${instrument}/(?:BID|ASK)/((?:19|20)\\d{2})/(\\d{1,2})/(\\d{1,2})$`));
  if (match) {
    const [, year, month, day] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (date.getUTCFullYear() === Number(year) && date.getUTCMonth() + 1 === Number(month) && date.getUTCDate() === Number(day)) return ORIGIN + value;
  }
  throw invalidPath();
}

function checkAbort(signal) { signal?.throwIfAborted(); }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function edgeExecutable() {
  const candidates = [process.env["PROGRAMFILES(X86)"], process.env.PROGRAMFILES, process.env.LOCALAPPDATA]
    .filter(Boolean).map(root => path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"));
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* Try the next standard installation. */ }
  }
  const error = new Error("免费行情连接需要 Microsoft Edge，请安装后重试");
  error.status = 412;
  throw error;
}

async function openCdp(url) {
  const socket = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  const rejectPending = () => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("免费行情连接已断开，请重试")); }
    pending.clear();
  };
  socket.addEventListener("close", rejectPending);
  socket.addEventListener("error", rejectPending);
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    if (message.error) item.reject(new Error("免费行情连接未能完成请求，请重试"));
    else item.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error("免费行情连接准备超时，请重试")); }, 10_000);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("免费行情连接准备失败，请重试")); }, { once: true });
  });
  return {
    command(method, params = {}, sessionId, timeoutMs = 25_000) {
      if (socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("免费行情连接已断开，请重试"));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("免费行情读取超时，请稍后重试")); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try { socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
        catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
      });
    },
    close() { socket.close(); rejectPending(); },
  };
}

export async function launchDukascopyBrowser({ signal } = {}) {
  checkAbort(signal);
  const executable = await edgeExecutable();
  const directory = await mkdtemp(path.join(tmpdir(), PROFILE_PREFIX));
  let child, cdp, startupError, closed;
  const killOwnedProcess = () => { if (child && child.exitCode === null) child.kill(); };
  const close = () => closed ??= (async () => {
    try { await cdp?.command("Browser.close", {}, undefined, 1500); } catch { /* Browser.close can close its own connection. */ }
    cdp?.close(); killOwnedProcess(); process.removeListener("exit", killOwnedProcess);
    if (child?.exitCode === null) await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(1000)]);
    // Only remove the temporary profile created by this invocation.
    const absolute = path.resolve(directory), temporaryRoot = path.resolve(tmpdir()) + path.sep;
    if (absolute.startsWith(temporaryRoot) && path.basename(absolute).startsWith(PROFILE_PREFIX)) {
      await rm(absolute, { recursive: true, force: true, maxRetries: 2 }).catch(() => {});
    }
  })();
  try {
    child = spawn(executable, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${directory}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
    child.on("error", error => { startupError = error; });
    process.once("exit", killOwnedProcess);
    const deadline = Date.now() + 15_000;
    let portInfo;
    while (Date.now() < deadline) {
      checkAbort(signal);
      if (startupError || child.exitCode !== null) throw new Error("Microsoft Edge 未能准备免费行情连接，请关闭异常后台程序后重试");
      try { portInfo = (await readFile(path.join(directory, "DevToolsActivePort"), "utf8")).trim().split(/\r?\n/); } catch { /* The owned browser is still starting. */ }
      if (portInfo?.length === 2) break;
      await delay(100);
    }
    if (!portInfo || !/^\d+$/.test(portInfo[0]) || !portInfo[1].startsWith("/devtools/browser/")) throw new Error("免费行情连接准备超时，请重试");
    cdp = await openCdp(`ws://127.0.0.1:${portInfo[0]}${portInfo[1]}`);
    const { targetId } = await cdp.command("Target.createTarget", { url: WIDGET });
    const { sessionId } = await cdp.command("Target.attachToTarget", { targetId, flatten: true });
    let ready = false;
    while (Date.now() < deadline) {
      checkAbort(signal);
      const result = await cdp.command("Runtime.evaluate", { expression: 'location.origin === "https://widgets.dukascopy.com" && document.readyState !== "loading"', returnByValue: true }, sessionId);
      if (result.result?.value === true) { ready = true; break; }
      await delay(100);
    }
    if (!ready) throw new Error("Dukascopy 免费行情页面暂不可用，请稍后重试");
    return {
      async request(url, requestSignal) {
        checkAbort(requestSignal);
        const onAbort = () => { void close(); };
        requestSignal?.addEventListener("abort", onAbort, { once: true });
        try {
          const expression = `(async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 20000);
            try {
              const response = await fetch(${JSON.stringify(url)}, { signal: controller.signal, cache: "no-store", headers: { accept: "application/json, text/plain, */*" } });
              const body = await response.text();
              if (body.length > 2000000) throw new Error("Response too large");
              const headers = {};
              for (const name of ["content-type", "retry-after", "x-amzn-waf-action"]) { const value = response.headers.get(name); if (value) headers[name] = value; }
              return { status: response.status, headers, body };
            } finally { clearTimeout(timer); }
          })()`;
          const result = await cdp.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
          checkAbort(requestSignal);
          if (result.exceptionDetails || !result.result?.value) throw new Error("Dukascopy 免费行情连接未能读取数据，请稍后重试");
          return result.result.value;
        } finally { requestSignal?.removeEventListener("abort", onAbort); }
      },
      close,
    };
  } catch (error) { await close(); throw error; }
}

export function createDukascopyBrowserConnection({ launch = launchDukascopyBrowser, idleMs = 90_000 } = {}) {
  let session = null, chain = Promise.resolve(), idleTimer, disposed = false;
  const release = async () => { const current = session; session = null; await current?.close(); };
  return {
    async request(requestPath, { signal } = {}) {
      const url = dukascopyRequestUrl(requestPath);
      const operation = chain.then(async () => {
        if (disposed) throw new Error("免费行情连接已关闭");
        checkAbort(signal); clearTimeout(idleTimer);
        try {
          session ??= await launch({ signal });
          checkAbort(signal);
          if (disposed) throw new Error("免费行情连接已关闭");
          return await session.request(url, signal);
        } catch (error) { await release(); checkAbort(signal); throw error; }
        finally { if (!disposed) { idleTimer = setTimeout(() => { chain = chain.then(release, release); }, idleMs); idleTimer.unref?.(); } }
      });
      chain = operation.catch(() => {});
      return operation;
    },
    async close() { disposed = true; clearTimeout(idleTimer); await chain.catch(() => {}); await release(); },
  };
}

export async function handleDukascopyBrowserRequest(connection, request, response) {
  if (new URL(request.url ?? "/", "http://127.0.0.1").pathname !== "/dukascopy/json") return false;
  const send = (status, value) => {
    if (response.destroyed) return;
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify(value));
  };
  if (request.method !== "POST") { send(405, { error: "行情连接只接受读取请求" }); return true; }
  const address = request.socket.remoteAddress;
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address) || request.headers.origin) {
    send(403, { error: "行情连接仅供本机数据服务使用" }); return true;
  }
  if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] ?? "")) { send(400, { error: "行情请求格式无效" }); return true; }
  const controller = new AbortController();
  const onClose = () => { if (!response.writableEnded) controller.abort(); };
  response.on("close", onClose);
  try {
    const chunks = []; let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 2048) throw invalidPath();
      chunks.push(chunk);
    }
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw invalidPath(); }
    const result = await connection.request(payload?.path, { signal: controller.signal });
    send(200, result);
  } catch (error) {
    send([400, 412].includes(error?.status) ? error.status : 502, { error: error instanceof Error ? error.message : "免费行情连接失败，请稍后重试" });
  } finally { response.removeListener("close", onClose); }
  return true;
}
