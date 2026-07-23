import { ensureSchema, getRawDb } from "../../../db/runtime";
import { loadProviderSecrets } from "../../lib/providerCredentials";

type ProviderSettingsInput = {
  provider?: "tushare" | "alpaca";
  tushareToken?: string;
  alpacaKeyId?: string;
  alpacaSecretKey?: string;
};

function hint(value?: string) {
  if (!value) return "";
  return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
}

export async function GET() {
  await ensureSchema();
  const { secrets, sources } = await loadProviderSecrets();
  return Response.json({
    providers: {
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
    },
  });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const payload = await request.json() as ProviderSettingsInput;
  let credentials: Record<string, string>;
  if (payload.provider === "tushare") {
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
  if (provider !== "tushare" && provider !== "alpaca") {
    return Response.json({ error: "不支持的数据源" }, { status: 400 });
  }
  await getRawDb()
    .prepare("DELETE FROM local_provider_credentials WHERE provider = ?")
    .bind(provider)
    .run();
  const { secrets, sources } = await loadProviderSecrets();
  const configured = provider === "tushare"
    ? Boolean(secrets.tushareToken)
    : Boolean(secrets.alpacaKeyId && secrets.alpacaSecretKey);
  return Response.json({ provider, configured, source: sources[provider] });
}
