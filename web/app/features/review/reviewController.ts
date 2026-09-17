import type {
  ReviewRestoreRequest,
  ReviewSessionFilterRecord,
  ReviewSessionFilters,
} from "./reviewContracts.ts";

export const REVIEW_SESSION_PAGE_SIZE = 50;
export const REVIEW_SESSION_SUMMARY_BATCH_SIZE = 24;

export type ReviewSessionActivityState = {
  positions: readonly unknown[];
  pendingOrders: readonly unknown[];
  executions: readonly unknown[];
  orderRejections: readonly unknown[];
  drawings: readonly unknown[];
  events: readonly ({ type?: unknown } | null)[];
  hasDecisionContent: boolean;
};

const passiveTrainingEventTypes = new Set([
  "session_created",
  "session_restored",
  "session_manually_saved",
  "replay_advanced",
  "replay_rewound",
  "playback_toggled",
  "playback_speed_changed",
  "training_completed",
  "training_revealed",
]);

export function hasMeaningfulTrainingActivity(state: ReviewSessionActivityState) {
  return state.positions.length > 0
    || state.pendingOrders.length > 0
    || state.executions.length > 0
    || state.orderRejections.length > 0
    || state.drawings.length > 0
    || state.hasDecisionContent
    || state.events.some((event) => (
      !event
      || typeof event.type !== "string"
      || !passiveTrainingEventTypes.has(event.type)
    ));
}

type ReviewSessionSummaryBatchOptions = {
  batchSize?: number;
  shouldCancel?: () => boolean;
  yieldToBrowser?: () => Promise<void>;
};

export function nextReviewSessionVisibleCount(
  currentCount: number,
  totalCount: number,
  pageSize = REVIEW_SESSION_PAGE_SIZE,
) {
  const safeCurrentCount = Number.isFinite(currentCount) ? Math.max(0, Math.floor(currentCount)) : 0;
  const safeTotalCount = Number.isFinite(totalCount) ? Math.max(0, Math.floor(totalCount)) : 0;
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : REVIEW_SESSION_PAGE_SIZE;
  return Math.min(safeTotalCount, safeCurrentCount + safePageSize);
}

export function visibleReviewSessionItems<T extends { selected?: boolean }>(
  items: readonly T[],
  visibleCount: number,
) {
  const safeVisibleCount = Number.isFinite(visibleCount) ? Math.max(0, Math.floor(visibleCount)) : 0;
  const visible = items.slice(0, safeVisibleCount);
  const selectedIndex = items.findIndex((item) => item.selected === true);
  if (selectedIndex < safeVisibleCount || selectedIndex < 0) return visible;
  return [...visible, items[selectedIndex]];
}

export async function buildReviewSessionSummariesInBatches<TSession, TSummary>(
  sessions: readonly TSession[],
  buildSummary: (session: TSession) => TSummary | null,
  options: ReviewSessionSummaryBatchOptions = {},
): Promise<{ status: "completed" | "cancelled"; summaries: TSummary[] }> {
  const batchSize = Number.isFinite(options.batchSize) && (options.batchSize ?? 0) > 0
    ? Math.floor(options.batchSize as number)
    : REVIEW_SESSION_SUMMARY_BATCH_SIZE;
  const shouldCancel = options.shouldCancel ?? (() => false);
  const yieldToBrowser = options.yieldToBrowser ?? (() => new Promise<void>((resolve) => {
    if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
      window.setTimeout(resolve, 0);
      return;
    }
    setTimeout(resolve, 0);
  }));
  const summaries: TSummary[] = [];

  for (let start = 0; start < sessions.length; start += batchSize) {
    if (shouldCancel()) return { status: "cancelled", summaries };
    const end = Math.min(sessions.length, start + batchSize);
    for (let index = start; index < end; index += 1) {
      const summary = buildSummary(sessions[index]);
      if (summary !== null) summaries.push(summary);
    }
    if (end < sessions.length) await yieldToBrowser();
  }

  return { status: "completed", summaries };
}

export function filterReviewSessions<T extends ReviewSessionFilterRecord>(
  sessions: readonly T[],
  filters: ReviewSessionFilters,
) {
  const query = filters.query.trim().toLocaleLowerCase();
  return sessions.filter((session) => (
    (!query
      || session.instrumentId.toLocaleLowerCase().includes(query)
      || session.modeLabel.toLocaleLowerCase().includes(query)
      || session.patternNames.some((name) => name.toLocaleLowerCase().includes(query)))
    && (filters.timeframe === "all" || session.timeframe === filters.timeframe)
    && (filters.modeLabel === "all" || session.modeLabel === filters.modeLabel)
    && (filters.status === "all" || (filters.status === "completed" ? session.completed : !session.completed))
    && (filters.planStatus === "all" || (filters.planStatus === "written" ? session.hasPlan : !session.hasPlan))
  ));
}

export function createReviewRestoreRequest(
  sessionId: string,
  preview = false,
  evidenceTimestamp?: number,
): ReviewRestoreRequest {
  return {
    sessionId,
    preview,
    ...(typeof evidenceTimestamp === "number" ? { evidenceTimestamp } : {}),
  };
}

export function normalizeReviewError(error: unknown, fallback = "复盘操作失败") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}
