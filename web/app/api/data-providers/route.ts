import { ensureSchema } from "../../../db/runtime";
import { loadProviderSecrets } from "../../lib/providerCredentials";

export async function GET() {
  await ensureSchema();
  const { secrets, tdxQuantEndpoint } = await loadProviderSecrets();
  return Response.json({
    providers: [
      {
        id: "tushare",
        name: "Tushare Pro",
        market: "A股",
        configured: Boolean(secrets.tushareToken),
        supportedTimeframes: ["5m", "1h", "1d", "1w"],
        credentialNames: ["TUSHARE_TOKEN"],
      },
      {
        id: "alpaca",
        name: "Alpaca Market Data",
        market: "美股",
        configured: Boolean(secrets.alpacaKeyId && secrets.alpacaSecretKey),
        supportedTimeframes: ["5m", "1h", "1d", "1w"],
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
