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
        id: "baostock",
        name: "BaoStock",
        market: "A股",
        configured: true,
        supportedTimeframes: ["1d", "1w", "1mo"],
        credentialNames: [],
      },
      {
        id: "tushare",
        name: "Tushare Pro",
        market: "A股不复权日线",
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
        name: "TdxQuant 本地服务地址",
        market: "A股增强（可复权）",
        configured: Boolean(tdxQuantEndpoint),
        supportedTimeframes: ["5m", "1h", "1d", "1w"],
        credentialNames: [],
      },
      {
        id: "dukascopy",
        name: "Dukascopy Official CSV Adapter",
        market: "外汇与黄金",
        configured: true,
        supportedTimeframes: ["1m"],
        credentialNames: [],
      },
    ],
  });
}
