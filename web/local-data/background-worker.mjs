import http from "node:http";
import { pathToFileURL } from "node:url";

import { createBackgroundAutoUpdateRunner } from "./background-auto-update.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3102;
const DEFAULT_SCHEDULE_MS = 5 * 60 * 1000;

function assertLoopbackHost(host) {
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new RangeError("后台 worker 只能监听 loopback 本机地址");
  }
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(token|secret|credential|password|apiKey)/i.test(key))
    .map(([key, item]) => [key, sanitize(item)]));
}

function logLine(logger, level, message, details = {}) {
  logger({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...details,
  });
}

export function createBackgroundWorkerServer({
  runner,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  scheduleMs = DEFAULT_SCHEDULE_MS,
  logger = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`),
} = {}) {
  assertLoopbackHost(host);
  if (!runner || typeof runner.getState !== "function" || typeof runner.runIfDue !== "function" || typeof runner.stop !== "function") {
    throw new TypeError("后台 worker 需要可用的 runner");
  }

  let server = null;
  let timer = null;
  let stopPromise = null;
  let boundPort = null;

  async function runScheduledUpdate() {
    try {
      await runner.runIfDue();
    } catch (error) {
      logLine(logger, "error", error instanceof Error ? error.message : String(error));
    }
  }

  function handleRequest(request, response) {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, {
        ok: true,
        service: "kline-background-worker",
        serviceVersion: 1,
      });
    }
    if (request.method === "GET" && url.pathname === "/status") {
      return sendJson(response, 200, sanitize(runner.getState()));
    }
    if (request.method === "POST" && url.pathname === "/shutdown") {
      sendJson(response, 200, { stopping: true });
      setTimeout(() => void stop(), 0);
      return;
    }
    return sendJson(response, 404, { error: "接口不存在" });
  }

  async function start() {
    if (server) return api;
    server = http.createServer((request, response) => {
      try {
        handleRequest(request, response);
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    });
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server?.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server?.off("error", onError);
        const address = server?.address();
        boundPort = typeof address === "object" && address ? address.port : port;
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });
    timer = setInterval(() => void runScheduledUpdate(), scheduleMs);
    void runScheduledUpdate();
    logLine(logger, "info", `后台任务服务：http://${host}:${boundPort}`);
    return api;
  }

  async function stop() {
    if (stopPromise) return await stopPromise;
    stopPromise = (async () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      runner.stop();
      if (!server) return;
      const currentServer = server;
      server = null;
      await new Promise((resolve) => currentServer.close(() => resolve()));
    })();
    return await stopPromise;
  }

  const api = {
    get port() {
      return boundPort ?? port;
    },
    start,
    stop,
  };
  return api;
}

async function main() {
  const runner = createBackgroundAutoUpdateRunner({
    origin: process.env.KLINE_WEB_ORIGIN ?? "http://127.0.0.1:3101",
    onLog: (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`),
  });
  const service = createBackgroundWorkerServer({
    runner,
    host: process.env.KLINE_BACKGROUND_HOST ?? DEFAULT_HOST,
    port: Number(process.env.KLINE_BACKGROUND_PORT ?? DEFAULT_PORT),
    scheduleMs: Number(process.env.KLINE_BACKGROUND_SCHEDULE_MS ?? DEFAULT_SCHEDULE_MS),
  });
  const shutdown = async () => {
    await service.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await service.start();
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath && import.meta.url === invokedPath) {
  await main();
}
