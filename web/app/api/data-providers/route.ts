import { env } from "cloudflare:workers";

type MarketDataEnv = {
  TUSHARE_TOKEN?: string;
  APCA_API_KEY_ID?: string;
  APCA_API_SECRET_KEY?: string;
};

export async function GET() {
  const secrets = env as unknown as MarketDataEnv;
  return Response.json({
    providers: [
      {
        id: "tushare",
        name: "Tushare Pro",
        market: "A股",
        configured: Boolean(secrets.TUSHARE_TOKEN),
        supportedTimeframes: ["5m", "1h", "1d", "1w"],
        credentialNames: ["TUSHARE_TOKEN"],
      },
      {
        id: "alpaca",
        name: "Alpaca Market Data",
        market: "美股",
        configured: Boolean(secrets.APCA_API_KEY_ID && secrets.APCA_API_SECRET_KEY),
        supportedTimeframes: ["5m", "1h", "1d", "1w"],
        credentialNames: ["APCA_API_KEY_ID", "APCA_API_SECRET_KEY"],
      },
    ],
  });
}
