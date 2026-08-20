"use client";

import { TrainingWorkbench } from "../../../components/TrainingWorkbench";

/**
 * Route-level composition boundary for the modular monolith.
 *
 * TrainingWorkbench still owns the hot replay/trading state in Phase 1; this
 * shell gives the app route a stable place to assemble that core with feature
 * panels while the remaining hot-state extraction is deferred.
 */
export function TrainingWorkbenchShell() {
  return <TrainingWorkbench />;
}
