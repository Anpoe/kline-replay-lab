export const RANDOM_TRAINING_OVERLAP_WARNING_THRESHOLD = 0.8;

export type TrainingWindowCandidate<T> = {
  value: T;
  startTimestamp: number;
  endTimestamp: number;
};

export type TrainingWindowOverlap<T> = {
  value: T;
  overlapBars: number;
  currentBarCount: number;
  overlapRatio: number;
};

export function calculateTrainingWindowOverlap(
  currentBarTimestamps: number[],
  previousStartTimestamp: number,
  previousEndTimestamp: number,
) {
  const currentTimestamps = [...new Set(currentBarTimestamps.filter(Number.isFinite))];
  if (!currentTimestamps.length
    || !Number.isFinite(previousStartTimestamp)
    || !Number.isFinite(previousEndTimestamp)) {
    return { overlapBars: 0, currentBarCount: currentTimestamps.length, overlapRatio: 0 };
  }
  const rangeStart = Math.min(previousStartTimestamp, previousEndTimestamp);
  const rangeEnd = Math.max(previousStartTimestamp, previousEndTimestamp);
  const overlapBars = currentTimestamps.filter((timestamp) => (
    timestamp >= rangeStart && timestamp <= rangeEnd
  )).length;
  return {
    overlapBars,
    currentBarCount: currentTimestamps.length,
    overlapRatio: overlapBars / currentTimestamps.length,
  };
}

export function findStrongestTrainingWindowOverlap<T>(
  currentBarTimestamps: number[],
  candidates: TrainingWindowCandidate<T>[],
  threshold = RANDOM_TRAINING_OVERLAP_WARNING_THRESHOLD,
): TrainingWindowOverlap<T> | null {
  let strongest: TrainingWindowOverlap<T> | null = null;
  candidates.forEach((candidate) => {
    const overlap = calculateTrainingWindowOverlap(
      currentBarTimestamps,
      candidate.startTimestamp,
      candidate.endTimestamp,
    );
    if (overlap.overlapRatio <= threshold
      || (strongest && overlap.overlapRatio <= strongest.overlapRatio)) return;
    strongest = { value: candidate.value, ...overlap };
  });
  return strongest;
}
