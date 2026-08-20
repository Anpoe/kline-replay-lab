import type {
  ReviewRestoreRequest,
  ReviewSessionFilterRecord,
  ReviewSessionFilters,
} from "./reviewContracts.ts";

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
