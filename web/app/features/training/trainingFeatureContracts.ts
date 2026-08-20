/**
 * Cross-feature inputs and events owned by the training page shell.
 *
 * These are deliberately data-only contracts. Feature implementations must
 * not import TrainingWorkbench or reach into its React state.
 */
export interface TrainingFeatureContext {
  market: string;
  symbol: string;
  timeframe: string;
  taskId?: string;
}

export interface TrainingFeatureError {
  feature: "settings" | "market-data" | "review" | "live";
  message: string;
}

export interface TrainingDataRefreshNotice {
  reason: "coverage-changed" | "sync-completed" | "source-changed";
}

export interface TrainingReviewRestoreRequest {
  sessionId: string;
}

export interface TrainingLiveSelection {
  symbol: string;
  market: string;
  timeframe: string;
  timestamp?: number;
}
