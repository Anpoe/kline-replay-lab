import http from "node:http";
import { TdxLocalStore } from "./store.mjs";

const host = process.env.KLINE_DATA_HOST ?? "127.0.0.1";
const port = Number(process.env.KLINE_DATA_PORT ?? 3100);
const serviceVersion = 2;
const store = await new TdxLocalStore().init();

function send(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "access-control-allow-origin": "http://localhost:3101",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") return send(response, 204, {});
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      const manifest = await store.getManifest();
      return send(response, 200, {
        ok: true,
        service: "kline-local-data",
        serviceVersion,
        task: store.getTask(),
        dataset: manifest ? {
          datasetVersion: manifest.datasetVersion,
          createdAt: manifest.createdAt,
          instrumentCount: manifest.instruments.length,
        } : null,
      });
    }
    if (request.method === "GET" && url.pathname === "/tasks/current") {
      return send(response, 200, { task: store.getTask() });
    }
    if (request.method === "GET" && url.pathname === "/catalog/status") {
      return send(response, 200, { catalogTask: store.getCatalogTask() });
    }
    if (request.method === "GET" && url.pathname === "/maintenance/cn/status") {
      return send(response, 200, { maintenanceTask: store.getCnMaintenanceTask() });
    }
    if (request.method === "POST" && url.pathname === "/tasks") {
      return send(response, 201, { task: await store.createTask(await readJson(request)) });
    }
    if (request.method === "POST" && url.pathname === "/tasks/current/pause") {
      return send(response, 200, { task: await store.pauseTask() });
    }
    if (request.method === "POST" && url.pathname === "/tasks/current/resume") {
      return send(response, 200, { task: await store.resumeTask() });
    }
    if (request.method === "POST" && url.pathname === "/catalog/refresh") {
      return send(response, 202, { catalogTask: await store.startCatalogRefresh() });
    }
    if (request.method === "POST" && url.pathname === "/maintenance/cn/start") {
      const payload = await readJson(request);
      return send(response, 202, {
        maintenanceTask: await store.startCnMaintenance({
          mode: payload.mode,
          token: payload.token,
          repairDays: payload.repairDays,
        }),
      });
    }
    if (request.method === "POST" && url.pathname === "/maintenance/cn/pause") {
      return send(response, 200, { maintenanceTask: await store.pauseCnMaintenance() });
    }
    if (request.method === "POST" && url.pathname === "/maintenance/cn/resume") {
      const payload = await readJson(request);
      return send(response, 200, {
        maintenanceTask: await store.resumeCnMaintenance(payload.token),
      });
    }
    if (request.method === "DELETE" && url.pathname === "/data") {
      const payload = await readJson(request);
      return send(response, 200, await store.deleteInstruments(
        Array.isArray(payload.instrumentIds) ? payload.instrumentIds : [],
      ));
    }
    if (request.method === "DELETE" && url.pathname === "/tasks/current") {
      const payload = await readJson(request);
      await store.deleteTask({ removeData: Boolean(payload.removeData) });
      return send(response, 200, { deleted: true });
    }
    if (request.method === "GET" && url.pathname === "/instruments") {
      return send(response, 200, { instruments: await store.getInstruments() });
    }
    if (request.method === "GET" && url.pathname === "/coverage") {
      return send(response, 200, await store.getCoverage({
        offset: Number(url.searchParams.get("offset") ?? 0),
        limit: Number(url.searchParams.get("limit") ?? 100),
        query: url.searchParams.get("q") ?? "",
      }));
    }
    if (request.method === "GET" && url.pathname === "/candles") {
      const result = await store.getCandles(
        url.searchParams.get("instrument") ?? "",
        url.searchParams.get("timeframe") ?? "1d",
      );
      return result ? send(response, 200, result) : send(response, 404, { error: "本机 TDX 数据中未找到该品种或周期" });
    }
    if (request.method === "POST" && url.pathname === "/prices/latest") {
      const payload = await readJson(request);
      return send(response, 200, { prices: await store.getLatestCandles(
        Array.isArray(payload.instrumentIds) ? payload.instrumentIds : [],
        payload.entryAfter && typeof payload.entryAfter === "object" ? payload.entryAfter : {},
      ) });
    }
    if (request.method === "POST" && url.pathname === "/scan/latest") {
      return send(response, 200, await store.scanLatest(await readJson(request)));
    }
    return send(response, 404, { error: "接口不存在" });
  } catch (error) {
    return send(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, host, () => {
  console.log(`K线训练营本机数据服务：http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => {
    store.close();
    process.exit(0);
  }));
}
