import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1_500;
const DEFAULT_SESSION_REFRESH_MS = 30 * 60 * 1_000;
const MAX_RETRY_DELAY_MS = 15_000;
// BaoStock's official Python client owns one process-global TCP socket and
// does not provide request multiplexing. Keep one long-lived bridge/session;
// the pool wrapper remains for compatibility with existing callers.
const DEFAULT_POOL_SIZE = 1;
const MAX_POOL_SIZE = 1;

function poolSize(value) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_POOL_SIZE;
  return Math.min(MAX_POOL_SIZE, Math.max(1, parsed));
}

function nonNegativeInteger(value, fallback) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function isRetryableError(error) {
  const message = String(error?.message ?? error);
  return /请求超时|网络|连接|接收|socket|桥接.*(?:失败|关闭|退出)|未登录|登录失败/i.test(message);
}

function retryDelay(baseDelayMs, attempt) {
  return Math.min(MAX_RETRY_DELAY_MS, baseDelayMs * (2 ** attempt));
}

function wait(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export class BaoStockClient {
  constructor(options = {}) {
    this.pythonCommand = options.pythonCommand ?? process.env.BAOSTOCK_PYTHON ?? "python";
    this.bridgePath = options.bridgePath ?? fileURLToPath(new URL("./baostock_bridge.py", import.meta.url));
    this.timeoutMs = nonNegativeNumber(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    this.maxRetries = nonNegativeInteger(options.maxRetries ?? DEFAULT_MAX_RETRIES, DEFAULT_MAX_RETRIES);
    this.retryDelayMs = nonNegativeNumber(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS);
    this.sessionRefreshMs = nonNegativeNumber(options.sessionRefreshMs ?? DEFAULT_SESSION_REFRESH_MS, DEFAULT_SESSION_REFRESH_MS);
    this.nowProvider = options.nowProvider ?? (() => Date.now());
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.child = null;
    this.processStartedAt = null;
    this.reader = null;
    this.nextId = 1;
    this.pending = new Map();
    this.requestTail = Promise.resolve();
    this.stderr = "";
    this.closed = false;
  }

  ensureProcess() {
    if (this.closed) throw new Error("BaoStock 本地桥接已关闭");
    if (this.child && !this.child.killed) {
      const sessionAge = this.processStartedAt !== null ? this.nowProvider() - this.processStartedAt : 0;
      if (this.sessionRefreshMs <= 0 || sessionAge < this.sessionRefreshMs) return;
      // BaoStock keeps its TCP socket inside the Python process. Refresh it
      // between requests so a long initialization does not age into a stale
      // session or wait for the server to close it first.
      this.resetProcess(new Error("BaoStock 会话已到刷新时间"));
    }
    this.stderr = "";
    const child = this.spawnProcess(this.pythonCommand, ["-u", this.bridgePath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.processStartedAt = this.nowProvider();
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4_000);
    });
    child.once("error", (error) => {
      if (this.child !== child) return;
      const message = error?.code === "ENOENT"
        ? `无法启动 Python：未找到“${this.pythonCommand}”。请安装 Python 3 并配置 BAOSTOCK_PYTHON。`
        : `BaoStock 本地桥接启动失败：${error instanceof Error ? error.message : String(error)}`;
      this.rejectPending(new Error(message));
      this.child = null;
    });
    child.once("close", (code) => {
      if (this.child !== child) return;
      this.child = null;
      if (code !== 0) {
        const detail = this.stderr.trim();
        this.rejectPending(new Error(
          detail.includes("No module named")
            ? "未安装 BaoStock Python 包，请执行：python -m pip install -r web/local-data/requirements.txt"
            : `BaoStock 本地桥接已退出（${code ?? "unknown"}）${detail ? `：${detail}` : ""}`,
        ));
      } else {
        this.rejectPending(new Error("BaoStock 本地桥接已关闭"));
      }
    });
    this.reader = createInterface({ input: child.stdout });
    this.reader.on("line", (line) => this.handleLine(line));
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const pending = this.pending.get(message?.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(String(message.error ?? "BaoStock 请求失败")));
  }

  rejectPending(error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  resetProcess(error) {
    const child = this.child;
    this.child = null;
    this.processStartedAt = null;
    this.reader?.close();
    this.reader = null;
    this.rejectPending(error);
    if (child && !child.killed) {
      try {
        child.kill();
      } catch {
        // The process may have exited between the timeout and kill call.
      }
    }
  }

  requestOnce(command, payload = {}) {
    this.ensureProcess();
    const child = this.child;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(`BaoStock 请求超时：${command}`);
        this.pending.delete(id);
        // BaoStock's Python client can remain blocked in recv() after a
        // timeout. Reusing that process would make resume hang again.
        this.resetProcess(error);
        reject(error);
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(`${JSON.stringify({ id, command, ...payload })}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        const bridgeError = new Error(`BaoStock 本地桥接写入失败：${error instanceof Error ? error.message : String(error)}`);
        this.resetProcess(bridgeError);
        reject(bridgeError);
      }
    });
  }

  async requestWithRetry(command, payload = {}) {
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.requestOnce(command, payload);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt >= this.maxRetries || !isRetryableError(lastError)) throw lastError;
        // BaoStock reports an empty/closed socket as "网络接收错误" while its
        // Python bridge stays alive. Retrying on that same process reuses the
        // broken process-global socket, so replace the session before retrying.
        this.resetProcess(lastError);
        await wait(retryDelay(this.retryDelayMs, attempt));
      }
    }
    throw lastError;
  }

  request(command, payload = {}) {
    // Keep catalog, history and trade-date calls serialized even if two UI
    // actions arrive at the local server at the same time.
    const request = this.requestTail.then(
      () => this.requestWithRetry(command, payload),
      () => this.requestWithRetry(command, payload),
    );
    this.requestTail = request.catch(() => undefined);
    return request;
  }

  async queryCatalog() {
    return await this.request("catalog");
  }

  async queryHistory(request) {
    return await this.request("history", request);
  }

  async queryTradeDates(request) {
    return await this.request("trade_dates", request);
  }

  close() {
    this.closed = true;
    this.resetProcess(new Error("BaoStock 本地桥接已关闭"));
  }
}

/**
 * BaoStock handles one request at a time through its process-global socket.
 * Multiple sessions are not a supported way to turn this C/S API into a
 * concurrent downloader, so keep exactly one bridge for the local service.
 */
export class BaoStockClientPool {
  constructor(options = {}) {
    const configuredSize = options.poolSize ?? process.env.BAOSTOCK_CONCURRENCY ?? DEFAULT_POOL_SIZE;
    this.clients = Array.from({ length: poolSize(configuredSize) }, () => new BaoStockClient(options.clientOptions));
    this.nextIndex = 0;
  }

  nextClient() {
    const client = this.clients[this.nextIndex % this.clients.length];
    this.nextIndex = (this.nextIndex + 1) % this.clients.length;
    return client;
  }

  queryCatalog() {
    return this.clients[0].queryCatalog();
  }

  queryHistory(request) {
    return this.nextClient().queryHistory(request);
  }

  queryTradeDates(request) {
    return this.clients[0].queryTradeDates(request);
  }

  close() {
    for (const client of this.clients) client.close();
  }
}
