export type TrainingAutosaveGate = {
  initialized: boolean;
  signature: string;
};

export function resetTrainingAutosaveGate(): TrainingAutosaveGate {
  return { initialized: false, signature: "" };
}

export function observeTrainingAutosave(
  gate: TrainingAutosaveGate,
  signature: string,
) {
  if (!gate.initialized) {
    return {
      gate: { initialized: true, signature },
      shouldSave: false,
    };
  }
  return {
    gate,
    shouldSave: gate.signature !== signature,
  };
}

export function markTrainingAutosaveSaved(
  _gate: TrainingAutosaveGate,
  signature: string,
): TrainingAutosaveGate {
  return { initialized: true, signature };
}
