import { env } from "cloudflare:workers";
import { getRawDb } from "../../db/runtime";
import type { ProviderSecrets } from "./marketDataProviders";

type MarketDataEnv = {
  TUSHARE_TOKEN?: string;
  APCA_API_KEY_ID?: string;
  APCA_API_SECRET_KEY?: string;
  TWELVE_DATA_API_KEY?: string;
  DUKASCOPY_CSV_ENDPOINT?: string;
};

type StoredCredentials = {
  tushareToken?: string;
  alpacaKeyId?: string;
  alpacaSecretKey?: string;
  tdxQuantEndpoint?: string;
  twelveDataApiKey?: string;
  dukascopyEndpoint?: string;
};

type StoredRow = {
  provider: string;
  credentialsJson: string;
};

function parseCredentials(value: string) {
  try {
    return JSON.parse(value) as StoredCredentials;
  } catch {
    return {};
  }
}

export async function loadProviderSecrets(): Promise<{
  secrets: ProviderSecrets;
  tdxQuantEndpoint?: string;
  sources: {
    tushare: "settings" | "environment" | null;
    alpaca: "settings" | "environment" | null;
    tdxquant: "settings" | null;
    twelvedata: "settings" | "environment" | null;
    dukascopy: "settings" | "environment" | "builtin";
  };
}> {
  const rows = await getRawDb()
    .prepare(`SELECT provider, credentials_json AS credentialsJson
      FROM local_provider_credentials WHERE provider IN ('tushare', 'alpaca', 'tdxquant', 'twelvedata', 'dukascopy')`)
    .all<StoredRow>();
  const stored = Object.fromEntries(rows.results.map((row) => [row.provider, parseCredentials(row.credentialsJson)]));
  const runtime = env as unknown as MarketDataEnv;
  const tushareToken = stored.tushare?.tushareToken || runtime.TUSHARE_TOKEN;
  const alpacaKeyId = stored.alpaca?.alpacaKeyId || runtime.APCA_API_KEY_ID;
  const alpacaSecretKey = stored.alpaca?.alpacaSecretKey || runtime.APCA_API_SECRET_KEY;
  const tdxQuantEndpoint = stored.tdxquant?.tdxQuantEndpoint;
  const twelveDataApiKey = stored.twelvedata?.twelveDataApiKey || runtime.TWELVE_DATA_API_KEY;
  const dukascopyEndpoint = stored.dukascopy?.dukascopyEndpoint || runtime.DUKASCOPY_CSV_ENDPOINT;

  return {
    secrets: { tushareToken, alpacaKeyId, alpacaSecretKey, twelveDataApiKey, dukascopyEndpoint },
    tdxQuantEndpoint,
    sources: {
      tushare: stored.tushare?.tushareToken
        ? "settings"
        : runtime.TUSHARE_TOKEN ? "environment" : null,
      alpaca: stored.alpaca?.alpacaKeyId && stored.alpaca?.alpacaSecretKey
        ? "settings"
        : runtime.APCA_API_KEY_ID && runtime.APCA_API_SECRET_KEY ? "environment" : null,
      tdxquant: tdxQuantEndpoint ? "settings" : null,
      twelvedata: stored.twelvedata?.twelveDataApiKey ? "settings" : runtime.TWELVE_DATA_API_KEY ? "environment" : null,
      dukascopy: stored.dukascopy?.dukascopyEndpoint
        ? "settings"
        : runtime.DUKASCOPY_CSV_ENDPOINT
          ? "environment"
          : "builtin",
    },
  };
}
