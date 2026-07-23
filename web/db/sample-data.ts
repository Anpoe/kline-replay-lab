export type SeedCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
};

type MarketConfig = {
  id: string;
  symbol: string;
  name: string;
  market: "CN" | "US";
  timezone: string;
  precision: number;
  basePrice: number;
  seed: number;
};

export const SAMPLE_INSTRUMENTS: MarketConfig[] = [
  {
    id: "600519.SH",
    symbol: "600519.SH",
    name: "贵州茅台",
    market: "CN",
    timezone: "Asia/Shanghai",
    precision: 2,
    basePrice: 1468,
    seed: 519,
  },
  {
    id: "AAPL.US",
    symbol: "AAPL",
    name: "Apple",
    market: "US",
    timezone: "America/New_York",
    precision: 2,
    basePrice: 214,
    seed: 723,
  },
];

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function weekdays(start: Date, count: number) {
  const days: Date[] = [];
  const cursor = new Date(start);
  while (days.length < count) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) {
      days.push(new Date(cursor));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function nextBar(previous: number, random: () => number, volatility: number) {
  const drift = (random() - 0.475) * volatility;
  const open = previous * (1 + (random() - 0.5) * volatility * 0.35);
  const close = Math.max(0.01, open * (1 + drift));
  const spread = Math.max(open, close) * volatility * (0.28 + random() * 0.7);
  const high = Math.max(open, close) + spread * random();
  const low = Math.max(0.01, Math.min(open, close) - spread * random());
  return { open, high, low, close };
}

export function generateDaily(config: MarketConfig, count = 220): SeedCandle[] {
  const random = rng(config.seed);
  const days = weekdays(new Date("2024-08-01T00:00:00Z"), count);
  let previous = config.basePrice;
  return days.map((day, index) => {
    const bar = nextBar(previous, random, 0.018);
    previous = bar.close;
    const volume = Math.round((620000 + random() * 4200000) * (1 + (index % 17) / 30));
    return {
      timestamp: day.getTime(),
      ...bar,
      volume,
      turnover: volume * bar.close,
    };
  });
}

export function generateIntraday(config: MarketConfig, dayCount = 7): SeedCandle[] {
  const random = rng(config.seed * 13);
  const days = weekdays(new Date("2025-06-09T00:00:00Z"), dayCount);
  let previous = config.basePrice * 1.035;
  const bars: SeedCandle[] = [];
  for (const day of days) {
    const barsPerDay = config.market === "CN" ? 48 : 78;
    const startHour = config.market === "CN" ? 1 : 13;
    const startMinute = config.market === "CN" ? 30 : 30;
    for (let i = 0; i < barsPerDay; i += 1) {
      let minuteOffset = i * 5;
      if (config.market === "CN" && i >= 24) minuteOffset += 90;
      const timestamp = Date.UTC(
        day.getUTCFullYear(),
        day.getUTCMonth(),
        day.getUTCDate(),
        startHour,
        startMinute + minuteOffset,
      );
      const bar = nextBar(previous, random, 0.0038);
      previous = bar.close;
      const volume = Math.round(18000 + random() * 240000);
      bars.push({
        timestamp,
        ...bar,
        volume,
        turnover: volume * bar.close,
      });
    }
  }
  return bars;
}

export function aggregateBars(source: SeedCandle[], size: number): SeedCandle[] {
  const result: SeedCandle[] = [];
  for (let i = 0; i < source.length; i += size) {
    const group = source.slice(i, i + size);
    if (!group.length) continue;
    result.push({
      timestamp: group[0].timestamp,
      open: group[0].open,
      high: Math.max(...group.map((bar) => bar.high)),
      low: Math.min(...group.map((bar) => bar.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, bar) => sum + bar.volume, 0),
      turnover: group.reduce((sum, bar) => sum + bar.turnover, 0),
    });
  }
  return result;
}
