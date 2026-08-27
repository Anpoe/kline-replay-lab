import { ensureSchema } from "../../../db/runtime";
import { DIRECT_PROVIDER_TIMEFRAMES } from "../../lib/marketDataProviders";
import { loadProviderSecrets } from "../../lib/providerCredentials";
import { TIMEFRAME_IDS } from "../../lib/timeframeCatalog";

export async function GET() {
  await ensureSchema();
  const { secrets, tdxQuantEndpoint } = await loadProviderSecrets();
  return Response.json({
    timeframeCatalog: [...TIMEFRAME_IDS],
    providers: [
      {
        id: "tushare",
        name: "Tushare Pro",
        market: "A股",
        configured: Boolean(secrets.tushareToken),
        supportedTimeframes: [...DIRECT_PROVIDER_TIMEFRAMES.tushare],
        credentialNames: ["TUSHARE_TOKEN"],
      },
      {
        id: "alpaca",
        name: "Alpaca Market Data",
        market: "美股",
        configured: Boolean(secrets.alpacaKeyId && secrets.alpacaSecretKey),
        supportedTimeframes: [...DIRECT_PROVIDER_TIMEFRAMES.alpaca],
        credentialNames: ["APCA_API_KEY_ID", "APCA_API_SECRET_KEY"],
      },
      {
        id: "tdxquant",
        name: "TdxQuant 本地客户端",
        market: "A股增强",
        configured: Boolean(tdxQuantEndpoint),
        supportedTimeframes: ["5m", "1h", "1d", "1w"],
        credentialNames: [],
      },
      {
        id: "twelvedata",
        name: "Twelve Data REST",
        market: "外汇",
        configured: Boolean(secrets.twelveDataApiKey),
        supportedTimeframes: ["1m"],
        credentialNames: ["TWELVE_DATA_API_KEY"],
      },
      {
        id: "dukascopy",
        name: "Dukascopy Official CSV Adapter",
        market: "外汇",
        configured: true,
        supportedTimeframes: ["1m"],
        credentialNames: [],
      },
    ],
  });
}
