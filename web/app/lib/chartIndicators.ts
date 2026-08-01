export type MovingAverageKind = "ma" | "ema";

export type MovingAverageIndicator = {
  enabled: boolean;
  periods: number[];
};

export type MovingAverageSettings = Record<MovingAverageKind, MovingAverageIndicator>;

export const MAX_MOVING_AVERAGE_LINES = 6;
export const MIN_MOVING_AVERAGE_PERIOD = 1;
export const MAX_MOVING_AVERAGE_PERIOD = 500;

export const defaultMovingAverageSettings: MovingAverageSettings = {
  ma: { enabled: true, periods: [5, 10, 20] },
  ema: { enabled: false, periods: [12, 26] },
};

export function normalizeMovingAveragePeriods(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return [...fallback];
  const periods = value
    .map(Number)
    .filter(Number.isFinite)
    .map((period) => Math.min(MAX_MOVING_AVERAGE_PERIOD, Math.max(MIN_MOVING_AVERAGE_PERIOD, Math.round(period))))
    .filter((period, index, values) => values.indexOf(period) === index)
    .slice(0, MAX_MOVING_AVERAGE_LINES);
  return periods.length ? periods : [...fallback];
}

export function normalizeMovingAverageSettings(value: unknown): MovingAverageSettings {
  const source = value && typeof value === "object"
    ? value as Partial<Record<MovingAverageKind, Partial<MovingAverageIndicator>>>
    : {};

  return {
    ma: {
      enabled: typeof source.ma?.enabled === "boolean" ? source.ma.enabled : defaultMovingAverageSettings.ma.enabled,
      periods: normalizeMovingAveragePeriods(source.ma?.periods, defaultMovingAverageSettings.ma.periods),
    },
    ema: {
      enabled: typeof source.ema?.enabled === "boolean" ? source.ema.enabled : defaultMovingAverageSettings.ema.enabled,
      periods: normalizeMovingAveragePeriods(source.ema?.periods, defaultMovingAverageSettings.ema.periods),
    },
  };
}
