export type LiveScanMarket = "CN" | "US";
export type LiveScanSort = "turnover" | "volume" | "change";

export type LiveScanResult = {
  instrumentId: string;
  symbol: string;
  name: string;
  market: LiveScanMarket;
  timestamp: number;
  close: number;
  changePct: number;
  volume: number;
  turnover: number;
  averageVolume: number;
  averageTurnover: number;
  presetIds: string[];
  presetNames: string[];
};

export type LiveScanResponse = {
  market: LiveScanMarket;
  latestTimestamp: number;
  scannedCount: number;
  matchedCount: number;
  results: LiveScanResult[];
  error?: string;
};
