import http from "node:http";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BaoStockLocalStore } from "./baostock-store.mjs";
import { TdxLocalStore } from "./legacy-tdx-store.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.KLINE_DATA_DIR ?? path.join(moduleDir, "..", ".local-data"));
const host = process.env.KLINE_DATA_HOST ?? "127.0.0.1";
const port = Number(process.env.KLINE_DATA_PORT ?? 3100);
const serviceVersion = 5;
const sourceSelectionFile = path.join(root, "source-selection.json");
const stores = {
  baostock: await new BaoStockLocalStore({ root }).init(),
  tdx: await new TdxLocalStore({ root }).init(),
};
const sourceDefinitions = {
  baostock: {
    id: "baostock",
    name: "BaoStock 前复权日线",
    adjustmentType: "qfq",
    adjustmentLabel: "前复权",
    description: "内置免费接口，直接返回前复权日线。",
  },
  tdx: {
    id: "tdx",
    name: "通达信官方日线包",
    adjustmentType: "none",
    adjustmentLabel: "不复权",
    description: "完整历史日线，保留原始交易价格，支持每日更新及权息标记。",
  },
};

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function loadActiveSource() {
  if (!(await exists(sourceSelectionFile))) {
    return await stores.tdx.getManifest() && !await stores.baostock.getManifest() ? "tdx" : "baostock";
  }
  try {
    const value = JSON.parse(await readFile(sourceSelectionFile, "utf8"));
    return value?.source === "tdx" ? "tdx" : "baostock";
  } catch {
    return "baostock";
  }
}

let activeSource = await loadActiveSource();

async function setActiveSource(source) {
  activeSource = source === "tdx" ? "tdx" : "baostock";
  await mkdir(root, { recursive: true });
  await writeFile(sourceSelectionFile, `${JSON.stringify({ source: activeSource }, null, 2)}\n`, "utf8");
}

function activeStore() {
  return stores[activeSource];
}

function sourceForPlan(payload = {}) {
  const value = String(payload.source ?? payload.provider ?? payload.cnInitialSource ?? "").trim().toLowerCase();
  if (value.includes("bao")) return "baostock";
  if (value === "tdx" || value.includes("tdx-zip") || value.includes("local-zip")) return "tdx";
  if (value === "tushare") return "tushare";
  if (value === "tdxquant") return "tdxquant";
  return "baostock";
}

function sourceList() {
  return [
    { ...sourceDefinitions.baostock, active: activeSource === "baostock" },
    { ...sourceDefinitions.tdx, active: activeSource === "tdx" },
    {
      id: "tushare",
      name: "Tushare daily",
      adjustmentType: "none",
      adjustmentLabel: "不复权",
      description: "按交易日更新不复权日线。",
      active: false,
    },
    {
      id: "tdxquant",
      name: "TdxQuant",
      adjustmentType: "provider-defined",
      adjustmentLabel: "可复权（按端点口径）",
      description: "提供分钟行情，复权方式以数据源设置为准。",
      active: false,
    },
  ];
}

async function datasetStatus(source = activeSource) {
  const store = stores[source];
  const manifest = await store.getManifest();
  if (!manifest) return null;
  const providerStatus = source === "baostock"
    ? await store.getDatasetStatus()
    : {
        source: manifest.maintenanceSource ? "tdx-official+tushare" : "tdx-official",
        adjustmentType: "none",
        adjustmentStatus: "not-adjusted",
        adjustmentSource: manifest.maintenanceSource ? "tushare-daily" : "tdx-official-hsjday",
        adjustmentUpdatedAt: null,
        factorCount: 0,
      };
  return {
    datasetVersion: manifest.datasetVersion,
    createdAt: manifest.createdAt,
    instrumentCount: Array.isArray(manifest.instruments) ? manifest.instruments.length : 0,
    corporateActions: source === "tdx" ? store.corporateActions.getStatus() : null,
    ...providerStatus,
  };
}

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
  const store = activeStore();
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      return send(response, 200, {
        ok: true,
        service: "kline-local-data",
        serviceVersion,
        activeSource,
        sources: sourceList(),
        task: store.getTask(),
        dataset: await datasetStatus(),
      });
    }
    if (request.method === "GET" && url.pathname === "/tasks/current") {
      return send(response, 200, {
        serviceVersion,
        activeSource,
        task: store.getTask(),
        dataset: await datasetStatus(),
      });
    }
    if (request.method === "GET" && url.pathname === "/catalog/status") {
      return send(response, 200, { serviceVersion, activeSource, catalogTask: store.getCatalogTask() });
    }
    if (url.pathname === "/corporate-actions" && request.method === "GET") {
      const instrumentId = url.searchParams.get("instrument");
      if (instrumentId && !/^\d{6}\.(SH|SZ|BJ)$/.test(instrumentId)) return send(response, 400, { error: "品种代码无效" });
      return send(response, 200, {
        corporateActions: stores.tdx.corporateActions.getStatus(),
        events: instrumentId ? stores.tdx.corporateActions.getEvents(instrumentId) : [],
      });
    }
    if (url.pathname === "/corporate-actions" && request.method === "POST") {
      if (activeSource !== "tdx") return send(response, 409, { error: "当前数据源不需要建立权息信息" });
      const { action = "start" } = await readJson(request);
      if (!["start", "pause", "resume"].includes(action)) return send(response, 400, { error: "不支持的权息操作" });
      const corporateActions = action === "start" ? await store.startCorporateActions()
        : action === "pause" ? await store.corporateActions.pause() : await store.corporateActions.resume();
      return send(response, 202, { corporateActions });
    }
    if (request.method === "GET" && url.pathname === "/maintenance/cn/status") {
      return send(response, 200, { serviceVersion, activeSource, maintenanceTask: store.getCnMaintenanceTask() });
    }
    if (request.method === "GET" && url.pathname === "/market/cn/status") {
      return send(response, 200, {
        serviceVersion,
        activeSource,
        source: sourceDefinitions[activeSource].id,
        latestClosedDate: store.getLatestClosedTradeDate ? await store.getLatestClosedTradeDate() : null,
      });
    }
    if (request.method === "POST" && url.pathname === "/tasks") {
      const payload = await readJson(request);
      const requestedSource = sourceForPlan(payload);
      if (requestedSource === "tushare") {
        return send(response, 409, { error: "Tushare daily 保留为逐批增量接口，不能单独替代全历史初始化；请选择 BaoStock 或通达信完整包。" });
      }
      if (requestedSource === "tdxquant") {
        return send(response, 409, { error: "TdxQuant 保留为可复权分钟/增强数据端点；全历史日线初始化请选择 BaoStock 或通达信完整包。" });
      }
      await setActiveSource(requestedSource);
      return send(response, 201, { activeSource, task: await activeStore().createTask(payload) });
    }
    if (request.method === "POST" && url.pathname === "/tasks/current/pause") {
      return send(response, 200, { task: await store.pauseTask() });
    }
    if (request.method === "POST" && url.pathname === "/tasks/current/resume") {
      return send(response, 200, { task: await store.resumeTask() });
    }
    if (request.method === "POST" && url.pathname === "/adjustment/start") {
      return send(response, 410, {
        error: activeSource === "baostock"
          ? "BaoStock 初始化时直接返回前复权价格，不再需要单独复权任务。"
          : "当前选择的通达信/Tushare 数据集是不复权数据；如需复权，请切换 BaoStock，或在 TdxQuant 端点选择复权口径。",
      });
    }
    if (request.method === "POST" && url.pathname === "/catalog/refresh") {
      return send(response, 202, { catalogTask: await store.startCatalogRefresh() });
    }
    if (request.method === "POST" && url.pathname === "/maintenance/cn/start") {
      const payload = await readJson(request);
      if (activeSource === "baostock") {
        return send(response, 202, {
          maintenanceTask: await store.startCnMaintenance({
            mode: payload.mode,
            repairDays: payload.repairDays,
          }),
        });
      }
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
        maintenanceTask: activeSource === "baostock"
          ? await store.resumeCnMaintenance()
          : await store.resumeCnMaintenance(payload.token),
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
      return send(response, 200, { deleted: true, activeSource });
    }
    if (request.method === "GET" && url.pathname === "/instruments") {
      return send(response, 200, { activeSource, instruments: await store.getInstruments() });
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
        url.searchParams.get("adjustmentType") ?? undefined,
      );
      return result
        ? send(response, 200, { ...result, activeSource })
        : send(response, 404, { error: `本机 ${activeSource === "baostock" ? "BaoStock" : "TDX"} 数据中未找到该品种或周期` });
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
  console.log(`K线训练营本机数据服务：http://${host}:${port}（默认 BaoStock，可切换旧 TDX/Tushare）`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => {
    stores.baostock.close();
    stores.tdx.close();
    process.exit(0);
  }));
}
