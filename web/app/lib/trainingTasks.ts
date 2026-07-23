export type TrainingMode = "free" | "blind" | "range" | "mistake";
export type TrainingStartMode = "default" | "date" | "bar" | "random";

export type TrainingTaskDraft = {
  mode: TrainingMode;
  startMode: TrainingStartMode;
  startDate: string;
  startBar: number;
  endDate: string;
  length: number;
  hideInstrument: boolean;
  hideDate: boolean;
  hidePrice: boolean;
  sourceSessionId?: string;
  sourceLabel?: string;
  randomStartDate?: string;
  randomEndDate?: string;
};

export type TrainingTask = {
  version: 1;
  mode: TrainingMode;
  startCursor: number;
  startTimestamp: number;
  endCursor: number;
  endTimestamp: number;
  requestedLength: number | null;
  hideInstrument: boolean;
  hideDate: boolean;
  hidePrice: boolean;
  sourceSessionId?: string;
  sourceLabel?: string;
  status: "active" | "completed";
  completedAt?: string;
};

type TimestampBar = { timestamp: number };

export const defaultTrainingTaskDraft: TrainingTaskDraft = {
  mode: "free",
  startMode: "default",
  startDate: "",
  startBar: 1,
  endDate: "",
  length: 0,
  hideInstrument: false,
  hideDate: false,
  hidePrice: false,
};

export const trainingModeLabels: Record<TrainingMode, string> = {
  free: "自由训练",
  blind: "盲测",
  range: "测试区间",
  mistake: "错题重练",
};

function seededFraction(seed: string) {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function dateKey(timestamp: number, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function findStartByDate(bars: TimestampBar[], date: string, timezone: string) {
  if (!date) return -1;
  const index = bars.findIndex((bar) => dateKey(bar.timestamp, timezone) >= date);
  return index >= 0 ? index : bars.length - 1;
}

function findEndByDate(bars: TimestampBar[], date: string, timezone: string) {
  if (!date) return -1;
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    if (dateKey(bars[index].timestamp, timezone) <= date) return index;
  }
  return 0;
}

export function resolveTrainingTask(
  draft: TrainingTaskDraft,
  bars: TimestampBar[],
  timezone: string,
  randomSeed: string,
): TrainingTask {
  if (!bars.length) throw new Error("没有可用于创建训练的 K 线");
  const lastCursor = bars.length - 1;
  const defaultCursor = clamp(Math.floor(bars.length * 0.68), 0, lastCursor);
  const desiredLength = Number.isFinite(draft.length) && draft.length > 0
    ? Math.max(1, Math.round(draft.length))
    : null;
  let startCursor = defaultCursor;

  if (draft.mode === "range") {
    const datedCursor = findStartByDate(bars, draft.startDate, timezone);
    startCursor = datedCursor >= 0 ? datedCursor : 0;
  } else if (draft.startMode === "date") {
    const datedCursor = findStartByDate(bars, draft.startDate, timezone);
    startCursor = datedCursor >= 0 ? datedCursor : defaultCursor;
  } else if (draft.startMode === "bar") {
    startCursor = clamp(Math.round(draft.startBar || 1) - 1, 0, lastCursor);
  } else if (draft.startMode === "random") {
    const historyContext = Math.min(40, Math.max(0, lastCursor - 1));
    const datedMinimum = draft.randomStartDate
      ? findStartByDate(bars, draft.randomStartDate, timezone)
      : historyContext;
    const datedMaximum = draft.randomEndDate
      ? findEndByDate(bars, draft.randomEndDate, timezone)
      : lastCursor;
    const minimumStart = clamp(Math.max(historyContext, datedMinimum), 0, lastCursor);
    const lengthSafeMaximum = Math.max(0, lastCursor - (desiredLength ?? 1));
    const maximumStart = clamp(
      Math.max(minimumStart, Math.min(datedMaximum, lengthSafeMaximum)),
      minimumStart,
      lastCursor,
    );
    const availableStarts = Math.max(1, maximumStart - minimumStart + 1);
    startCursor = clamp(
      minimumStart + Math.floor(seededFraction(randomSeed) * availableStarts),
      minimumStart,
      maximumStart,
    );
  }

  let endCursor = lastCursor;
  let requestedLength: number | null = null;
  if (draft.mode === "range") {
    const datedEnd = findEndByDate(bars, draft.endDate, timezone);
    endCursor = datedEnd >= 0 ? datedEnd : lastCursor;
  } else if (desiredLength) {
    requestedLength = desiredLength;
    endCursor = startCursor + requestedLength;
  }
  endCursor = clamp(Math.max(startCursor, endCursor), startCursor, lastCursor);

  return {
    version: 1,
    mode: draft.mode,
    startCursor,
    startTimestamp: bars[startCursor].timestamp,
    endCursor,
    endTimestamp: bars[endCursor].timestamp,
    requestedLength,
    hideInstrument: draft.hideInstrument,
    hideDate: draft.hideDate,
    hidePrice: draft.hidePrice,
    sourceSessionId: draft.sourceSessionId,
    sourceLabel: draft.sourceLabel,
    status: endCursor === startCursor ? "completed" : "active",
    completedAt: endCursor === startCursor ? new Date().toISOString() : undefined,
  };
}

export function createLegacyTrainingTask(bars: TimestampBar[], cursor: number): TrainingTask {
  const safeCursor = clamp(cursor, 0, Math.max(0, bars.length - 1));
  const endCursor = Math.max(safeCursor, bars.length - 1);
  return {
    version: 1,
    mode: "free",
    startCursor: safeCursor,
    startTimestamp: bars[safeCursor]?.timestamp ?? 0,
    endCursor,
    endTimestamp: bars[endCursor]?.timestamp ?? 0,
    requestedLength: null,
    hideInstrument: false,
    hideDate: false,
    hidePrice: false,
    status: safeCursor >= endCursor ? "completed" : "active",
  };
}

export function advanceWithinTask(task: TrainingTask, cursor: number, requestedCount: number) {
  return Math.min(task.endCursor, cursor + Math.max(1, requestedCount));
}

export function finishTask(task: TrainingTask, cursor: number, occurredAt = new Date().toISOString()): TrainingTask {
  if (cursor < task.endCursor || task.status === "completed") return task;
  return { ...task, status: "completed", completedAt: occurredAt };
}

export function taskProgress(task: TrainingTask, cursor: number) {
  const total = Math.max(0, task.endCursor - task.startCursor);
  const revealed = clamp(cursor - task.startCursor, 0, total);
  return {
    revealed,
    total,
    percent: total ? (revealed / total) * 100 : 100,
  };
}
