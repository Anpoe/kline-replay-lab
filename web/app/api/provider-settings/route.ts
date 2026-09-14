import { ensureSchema, getRawDb } from "../../../db/runtime";
import {
  isValidDataAutoUpdateScheduleTime,
  readDataAutoUpdateSettings,
  writeDataAutoUpdateSettings,
} from "../../lib/dataAutoUpdateSettings";
import { loadProviderSecrets } from "../../lib/providerCredentials";

type ProviderSettingsInput = {
  provider?: "baostock" | "tushare" | "alpaca" | "tdxquant" | "twelvedata" | "dukascopy";
  tushareToken?: string;
  alpacaKeyId?: string;
  alpacaSecretKey?: string;
  tdxQuantEndpoint?: string;
  twelveDataApiKey?: string;
  dukascopyEndpoint?: string;
  autoUpdateEnabled?: unknown;
  autoUpdateScheduledEnabled?: unknown;
  autoUpdateScheduleTime?: unknown;
};

function hint(value?: string) {
  if (!value) return "";
  return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
}

function publicAutoUpdateSettings(settings: Awaited<ReturnType<typeof readDataAutoUpdateSettings>>) {
  const { lastRunToken, ...safe } = settings;
  void lastRunToken;
  return safe;
}

export async function GET() {
  await ensureSchema();
  const db = getRawDb();
  const [{ secrets, sources, tdxQuantEndpoint }, autoUpdate] = await Promise.all([
    loadProviderSecrets(),
    readDataAutoUpdateSettings(db),
  ]);
  return Response.json({
    providers: {
      baostock: {
        configured: true,
        source: "builtin",
      },
      tushare: {
        configured: Boolean(secrets.tushareToken),
        source: sources.tushare,
        hint: hint(secrets.tushareToken),
      },
      alpaca: {
        configured: Boolean(secrets.alpacaKeyId && secrets.alpacaSecretKey),
        source: sources.alpaca,
        keyIdHint: hint(secrets.alpacaKeyId),
      },
      tdxquant: {
        configured: Boolean(tdxQuantEndpoint),
        source: sources.tdxquant,
        endpoint: tdxQuantEndpoint,
      },
      twelvedata: {
        configured: Boolean(secrets.twelveDataApiKey),
        source: sources.twelvedata,
        hint: hint(secrets.twelveDataApiKey),
      },
      dukascopy: {
        configured: true,
        source: sources.dukascopy,
        endpoint: secrets.dukascopyEndpoint,
      },
    },
    autoUpdate: {
      enabled: autoUpdate.enabled,
      scheduledEnabled: autoUpdate.scheduledEnabled,
      scheduledTime: autoUpdate.scheduledTime,
      lastCheckDate: autoUpdate.lastCheckDate,
      lastFinishedAt: autoUpdate.lastFinishedAt,
      lastStatus: autoUpdate.lastStatus,
      lastMessage: autoUpdate.lastMessage,
    },
  });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const payload = await request.json() as ProviderSettingsInput;
  const autoUpdatePatch: {
    enabled?: boolean;
    scheduledEnabled?: boolean;
    scheduledTime?: string;
  } = {};
  if (payload.autoUpdateEnabled !== undefined) {
    if (typeof payload.autoUpdateEnabled !== "boolean") {
      return Response.json({ error: "自动更新开关参数不正确" }, { status: 400 });
    }
    autoUpdatePatch.enabled = payload.autoUpdateEnabled;
  }
  if (payload.autoUpdateScheduledEnabled !== undefined) {
    if (typeof payload.autoUpdateScheduledEnabled !== "boolean") {
      return Response.json({ error: "定时自动更新开关参数不正确" }, { status: 400 });
    }
    autoUpdatePatch.scheduledEnabled = payload.autoUpdateScheduledEnabled;
  }
  if (payload.autoUpdateScheduleTime !== undefined) {
    if (!isValidDataAutoUpdateScheduleTime(payload.autoUpdateScheduleTime)) {
      return Response.json({ error: "定时检查时间格式不正确" }, { status: 400 });
    }
    autoUpdatePatch.scheduledTime = payload.autoUpdateScheduleTime;
  }
  if (Object.keys(autoUpdatePatch).length) {
    const autoUpdate = await writeDataAutoUpdateSettings(getRawDb(), autoUpdatePatch);
    return Response.json({ autoUpdate: publicAutoUpdateSettings(autoUpdate) });
  }
  let credentials: Record<string, string>;
  if (payload.provider === "baostock") {
    return Response.json({ error: "BaoStock 是本机内置数据源，无需配置 Token" }, { status: 400 });
  } else if (payload.provider === "tushare") {
    const token = payload.tushareToken?.trim();
    if (!token) return Response.json({ error: "请填写 Tushare Token" }, { status: 400 });
    credentials = { tushareToken: token };
  } else if (payload.provider === "alpaca") {
    const keyId = payload.alpacaKeyId?.trim();
    const secretKey = payload.alpacaSecretKey?.trim();
    if (!keyId || !secretKey) {
      return Response.json({ error: "请同时填写 Alpaca API Key ID 和 Secret Key" }, { status: 400 });
    }
    credentials = { alpacaKeyId: keyId, alpacaSecretKey: secretKey };
  } else if (payload.provider === "tdxquant") {
    const endpoint = payload.tdxQuantEndpoint?.trim().replace(/\/+$/, "");
    if (!endpoint) return Response.json({ error: "请填写 TdxQuant 本地端点" }, { status: 400 });
    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      return Response.json({ error: "TdxQuant 端点格式不正确" }, { status: 400 });
    }
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
      return Response.json({ error: "TdxQuant 只能连接本机 127.0.0.1 或 localhost" }, { status: 400 });
    }
    credentials = { tdxQuantEndpoint: endpoint };
  } else if (payload.provider === "twelvedata") {
    const apiKey = payload.twelveDataApiKey?.trim();
    if (!apiKey) return Response.json({ error: "请填写 Twelve Data API Key" }, { status: 400 });
    credentials = { twelveDataApiKey: apiKey };
  } else if (payload.provider === "dukascopy") {
    const endpoint = payload.dukascopyEndpoint?.trim();
    if (!endpoint) return Response.json({ error: "请填写 Dukascopy CSV 服务地址" }, { status: 400 });
    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      return Response.json({ error: "Dukascopy CSV 服务地址格式不正确" }, { status: 400 });
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      return Response.json({ error: "Dukascopy CSV 服务地址必须使用 HTTP 或 HTTPS" }, { status: 400 });
    }
    const allowedHost = parsed.hostname === "localhost"
      || parsed.hostname === "127.0.0.1"
      || parsed.hostname === "::1"
      || parsed.hostname === "dukascopy.com"
      || parsed.hostname.endsWith(".dukascopy.com");
    if (!allowedHost) {
      return Response.json({ error: "Dukascopy CSV 地址只允许 Dukascopy 官方域名或本机代理" }, { status: 400 });
    }
    credentials = { dukascopyEndpoint: endpoint };
  } else {
    return Response.json({ error: "不支持的数据源" }, { status: 400 });
  }

  await getRawDb()
    .prepare(`INSERT INTO local_provider_credentials (provider, credentials_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET
        credentials_json = excluded.credentials_json,
        updated_at = excluded.updated_at`)
    .bind(payload.provider, JSON.stringify(credentials), new Date().toISOString())
    .run();
  return Response.json({ provider: payload.provider, configured: true });
}

export async function DELETE(request: Request) {
  await ensureSchema();
  const provider = new URL(request.url).searchParams.get("provider");
  if (provider !== "tushare" && provider !== "alpaca" && provider !== "tdxquant" && provider !== "twelvedata" && provider !== "dukascopy") {
    return Response.json({ error: "不支持的数据源" }, { status: 400 });
  }
  await getRawDb()
    .prepare("DELETE FROM local_provider_credentials WHERE provider = ?")
    .bind(provider)
    .run();
  const { secrets, sources, tdxQuantEndpoint } = await loadProviderSecrets();
  const configured = provider === "tushare"
    ? Boolean(secrets.tushareToken)
    : provider === "alpaca"
    ? Boolean(secrets.alpacaKeyId && secrets.alpacaSecretKey)
      : provider === "tdxquant"
        ? Boolean(tdxQuantEndpoint)
        : provider === "twelvedata"
          ? Boolean(secrets.twelveDataApiKey)
          : true;
  return Response.json({ provider, configured, source: sources[provider] });
}
