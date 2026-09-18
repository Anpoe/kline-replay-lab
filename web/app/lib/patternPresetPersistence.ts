import type { PatternPreset } from "./patternFilters.ts";

export const PATTERN_PRESET_RESTORE_ACTION = "restore-defaults" as const;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function patternPresetId(value: unknown) {
  const record = asRecord(value);
  return typeof record?.id === "string" && record.id ? record.id : null;
}

export function hiddenBuiltInPatternPresetIds(presets: readonly PatternPreset[]) {
  return [...new Set(
    presets
      .filter((preset) => preset.builtIn && preset.enabled === false)
      .map((preset) => preset.id),
  )];
}

export function applyHiddenBuiltInPatternPresetIds(
  presets: readonly PatternPreset[],
  hiddenIds: readonly string[],
) {
  const hidden = new Set(hiddenIds);
  return presets.map((preset) => (
    preset.builtIn && hidden.has(preset.id)
      ? { ...preset, enabled: false }
      : preset
  ));
}

/**
 * Preserve hidden built-ins when a stale preference writer sends a visible
 * preset list. Only an explicit restore action may clear those flags.
 */
export function mergeHiddenBuiltInPatternPresets(
  incomingValue: unknown,
  existingValue: unknown,
  allowRestore = false,
): JsonRecord {
  const incoming = asRecord(incomingValue) ?? {};
  if (allowRestore) return incoming;

  const existing = asRecord(existingValue);
  const existingPresets = existing && Array.isArray(existing.patternPresets)
    ? existing.patternPresets
    : null;
  if (!existingPresets) return incoming;

  const hiddenById = new Map<string, JsonRecord>();
  for (const candidate of existingPresets) {
    const record = asRecord(candidate);
    const id = patternPresetId(candidate);
    if (record?.builtIn === true && record.enabled === false && id) hiddenById.set(id, record);
  }
  if (!hiddenById.size) return incoming;

  const incomingPresets = Array.isArray(incoming.patternPresets)
    ? incoming.patternPresets
    : existingPresets;
  const seen = new Set<string>();
  const mergedPresets = incomingPresets.map((candidate) => {
    const record = asRecord(candidate);
    const id = patternPresetId(candidate);
    const hidden = id ? hiddenById.get(id) : undefined;
    if (!id || !record || !hidden) return candidate;
    seen.add(id);
    return { ...record, enabled: false };
  });

  for (const [id, hidden] of hiddenById) {
    if (!seen.has(id)) mergedPresets.push(hidden);
  }
  return { ...incoming, patternPresets: mergedPresets };
}
