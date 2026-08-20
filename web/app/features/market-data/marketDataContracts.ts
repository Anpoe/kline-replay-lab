import { dataMarkets, type DataMarket } from "../../lib/dataMarkets";

export { dataMarkets, type DataMarket };

export type MarketDataRefreshReason = "import" | "sync" | "repair" | "delete" | "reload";

export type MarketDataRefreshNotice = {
  market: DataMarket;
  reason: MarketDataRefreshReason;
  changed: boolean;
  message?: string;
};

export type MarketDataError = {
  message: string;
  retryable: boolean;
};
