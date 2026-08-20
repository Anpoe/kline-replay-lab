export type ReviewSessionFilters = {
  query: string;
  timeframe: string;
  modeLabel: string;
  status: "all" | "active" | "completed";
  planStatus: "all" | "written" | "unwritten";
};

export const defaultReviewSessionFilters: ReviewSessionFilters = {
  query: "",
  timeframe: "all",
  modeLabel: "all",
  status: "all",
  planStatus: "all",
};

export type ReviewSessionFilterRecord = {
  instrumentId: string;
  timeframe: string;
  modeLabel: string;
  completed: boolean;
  hasPlan: boolean;
  patternNames: readonly string[];
};

export type ReviewRestoreRequest = {
  sessionId: string;
  preview: boolean;
  evidenceTimestamp?: number;
};
