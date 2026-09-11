export type AutoUpdateCompletionSnapshot = {
  lastFinishedAt?: unknown;
  lastStatus?: unknown;
};

/**
 * Returns true only when a later successful/partial background run is observed.
 * An undefined previous value means the caller is establishing its baseline.
 */
export function shouldRefreshLivePricesAfterAutoUpdate(
  previousFinishedAt: string | null | undefined,
  current: AutoUpdateCompletionSnapshot | null | undefined,
) {
  const nextFinishedAt = typeof current?.lastFinishedAt === "string" && current.lastFinishedAt
    ? current.lastFinishedAt
    : null;
  if (previousFinishedAt === undefined || nextFinishedAt === null || nextFinishedAt === previousFinishedAt) {
    return false;
  }
  return current?.lastStatus === "completed" || current?.lastStatus === "partial";
}
