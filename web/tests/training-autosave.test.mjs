import assert from "node:assert/strict";
import test from "node:test";

import {
  observeTrainingAutosave,
  resetTrainingAutosaveGate,
  markTrainingAutosaveSaved,
} from "../app/lib/trainingAutosave.ts";

test("a newly loaded training establishes a baseline without saving", () => {
  let gate = resetTrainingAutosaveGate();

  let observation = observeTrainingAutosave(gate, "old-training-edit");
  assert.equal(observation.shouldSave, false);
  gate = observation.gate;

  observation = observeTrainingAutosave(gate, "old-training-user-change");
  assert.equal(observation.shouldSave, true);
  gate = markTrainingAutosaveSaved(gate, "old-training-user-change");

  gate = resetTrainingAutosaveGate();
  observation = observeTrainingAutosave(gate, "new-training-empty-state");
  assert.equal(observation.shouldSave, false);
});

test("an actual edit after the baseline requests an autosave", () => {
  const baseline = observeTrainingAutosave(
    resetTrainingAutosaveGate(),
    "training-without-user-edits",
  ).gate;

  const observation = observeTrainingAutosave(baseline, "training-with-a-drawing");

  assert.equal(observation.shouldSave, true);
});
