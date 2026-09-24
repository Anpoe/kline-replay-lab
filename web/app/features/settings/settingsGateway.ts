import {
  defaultMovingAverageSettings,
  normalizeMovingAverageSettings,
  type MovingAverageSettings,
} from "../../lib/chartIndicators.ts";
import {
  defaultPatternPresets,
  normalizePatternPresets,
  type PatternPreset,
  visiblePatternPresets,
} from "../../lib/patternFilters.ts";
import {
  defaultAppSettings,
  normalizeSettings,
  type AppSettings,
} from "./settingsContracts.ts";

export const defaultReasonTags = ["顺势", "关键位置", "突破回踩", "失败突破", "二次入场", "信号K确认"];

export const settingsStorageKeys = Object.freeze({
  lastDraft: "kline-replay-lab:last-training",
  appSettings: "kline-replay-lab:settings",
  reasonTags: "kline-replay-lab:reason-tags-v1",
  customReasonTags: "kline-replay-lab:custom-reason-tags",
  patternPresets: "kline-replay-lab:pattern-presets-v1",
  hiddenPatternPresetIds: "kline-replay-lab:hidden-pattern-presets-v1",
  quickRandomPattern: "kline-replay-lab:quick-random-pattern-v1",
  randomTrainingPatternPresets: "kline-replay-lab:random-training-pattern-presets-v1",
  quickRandomMode: "kline-replay-lab:quick-random-mode-v1",
  movingAverageSettings: "kline-replay-lab:moving-average-indicators-v1",
});

export type SettingsStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type PatternPreferences = {
  patternPresets: PatternPreset[];
  quickRandomPatternPresetId: string;
  randomTrainingPatternPresetIds: string[];
  quickRandomMode: "free" | "blind";
};

export type ReasonTagPreferences = {
  reasonTags: string[];
  customReasonTags: string[];
};

export type LoadedAppSettings = {
  settings: AppSettings;
  recoveredFromCorruption: boolean;
};

export type SettingsFetchInit = {
  cache?: "no-store";
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type SettingsFetchResponse = {
  ok: boolean;
  json(): Promise<unknown>;
};

export type SettingsFetch = (
  input: string,
  init?: SettingsFetchInit,
) => Promise<SettingsFetchResponse>;

function cloneDefaultPatternPreferences(): PatternPreferences {
  const patternPresets = normalizePatternPresets(defaultPatternPresets);
  return {
    patternPresets,
    quickRandomPatternPresetId: "",
    randomTrainingPatternPresetIds: [],
    quickRandomMode: "free",
  };
}

function cloneDefaultReasonTagPreferences(): ReasonTagPreferences {
  return {
    reasonTags: [...defaultReasonTags],
    customReasonTags: [],
  };
}

function normalizeReasonTagText(value: string) {
  const text = value.trim().replace(/\s+/g, " ").slice(0, 20);
  if (!text) return "";
  const characters = [...text];
  const badIndexes = characters
    .map((character, index) => ({ character, index }))
    .filter(({ character }) => character === "\uFFFD" || ((character.codePointAt(0) ?? 0) >= 0x80 && (character.codePointAt(0) ?? 0) <= 0x9f))
    .map(({ index }) => index);
  if (!badIndexes.length) return text;
  const firstBad = badIndexes[0];
  const lastBad = badIndexes.at(-1) ?? firstBad;
  const prefix = characters.slice(0, firstBad).join("");
  const suffix = characters.slice(lastBad + 1).join("");
  return defaultReasonTags.find((option) => option.startsWith(prefix) && option.endsWith(suffix)) ?? "";
}

export function normalizeReasonTags(value: unknown, fallback: string[] = defaultReasonTags) {
  const source = Array.isArray(value) ? value : fallback;
  const normalized = source
    .filter((tag): tag is string => typeof tag === "string")
    .map(normalizeReasonTagText)
    .filter((tag, index, items) => Boolean(tag) && items.indexOf(tag) === index)
    .slice(0, 30);
  return Array.isArray(value) ? normalized : [...fallback];
}

function readJson(storage: SettingsStorage, key: string) {
  const stored = storage.getItem(key);
  return stored == null ? undefined : JSON.parse(stored) as unknown;
}

function normalizeHiddenPatternPresetIds(value: unknown) {
  const builtInIds = new Set(defaultPatternPresets.map((preset) => preset.id));
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && builtInIds.has(id)))];
}

export function createSettingsStorageGateway(storage: SettingsStorage) {
  const loadAppSettings = (): LoadedAppSettings => {
    const stored = storage.getItem(settingsStorageKeys.appSettings);
    if (stored == null) return { settings: normalizeSettings(defaultAppSettings), recoveredFromCorruption: false };
    try {
      const settings = normalizeSettings(JSON.parse(stored) as Partial<AppSettings>);
      // Persist the normalized shape on first read so legacy single-account
      // preferences gain independent training/live defaults without changing
      // the storage key or requiring a separate migration command.
      try {
        storage.setItem(settingsStorageKeys.appSettings, JSON.stringify(settings));
      } catch {
        // Reading settings must remain available even when storage is full.
      }
      return {
        settings,
        recoveredFromCorruption: false,
      };
    } catch {
      storage.removeItem(settingsStorageKeys.appSettings);
      return { settings: normalizeSettings(defaultAppSettings), recoveredFromCorruption: true };
    }
  };

  const saveAppSettings = (settings: AppSettings) => {
    storage.setItem(settingsStorageKeys.appSettings, JSON.stringify(normalizeSettings(settings)));
  };

  const loadHiddenPatternPresetIds = (): string[] => {
    try {
      return normalizeHiddenPatternPresetIds(readJson(storage, settingsStorageKeys.hiddenPatternPresetIds));
    } catch {
      storage.removeItem(settingsStorageKeys.hiddenPatternPresetIds);
      return [];
    }
  };

  const saveHiddenPatternPresetIds = (presetIds: string[], options?: { allowRestore?: boolean }) => {
    const normalized = normalizeHiddenPatternPresetIds([
      ...(options?.allowRestore ? [] : loadHiddenPatternPresetIds()),
      ...presetIds,
    ]);
    if (normalized.length) {
      storage.setItem(settingsStorageKeys.hiddenPatternPresetIds, JSON.stringify(normalized));
    } else {
      storage.removeItem(settingsStorageKeys.hiddenPatternPresetIds);
    }
  };

  const loadPatternPreferences = (): PatternPreferences => {
    try {
      const storedPresets = readJson(storage, settingsStorageKeys.patternPresets);
      const hiddenPresetIds = new Set(loadHiddenPatternPresetIds());
      const patternPresets = normalizePatternPresets(storedPresets ?? defaultPatternPresets).map((preset) => (
        preset.builtIn && hiddenPresetIds.has(preset.id)
          ? { ...preset, enabled: false }
          : preset
      ));
      const availablePatternPresets = visiblePatternPresets(patternPresets);
      const storedQuickPattern = storage.getItem(settingsStorageKeys.quickRandomPattern) ?? "";
      const storedRandomPatterns = readJson(storage, settingsStorageKeys.randomTrainingPatternPresets);
      const quickRandomPatternPresetId = availablePatternPresets.some((preset) => preset.id === storedQuickPattern)
        ? storedQuickPattern
        : "";
      const randomTrainingPatternPresetIds = Array.isArray(storedRandomPatterns)
        ? storedRandomPatterns.filter((id): id is string => (
          typeof id === "string" && availablePatternPresets.some((preset) => preset.id === id)
        ))
        : [];
      return {
        patternPresets,
        quickRandomPatternPresetId,
        randomTrainingPatternPresetIds,
        quickRandomMode: storage.getItem(settingsStorageKeys.quickRandomMode) === "blind" ? "blind" : "free",
      };
    } catch {
      storage.removeItem(settingsStorageKeys.patternPresets);
      storage.removeItem(settingsStorageKeys.quickRandomPattern);
      storage.removeItem(settingsStorageKeys.randomTrainingPatternPresets);
      storage.removeItem(settingsStorageKeys.quickRandomMode);
      return cloneDefaultPatternPreferences();
    }
  };

  const savePatternPresets = (patternPresets: PatternPreset[]) => {
    storage.setItem(settingsStorageKeys.patternPresets, JSON.stringify(normalizePatternPresets(patternPresets)));
  };

  const saveQuickRandomPattern = (presetId: string) => {
    if (presetId) storage.setItem(settingsStorageKeys.quickRandomPattern, presetId);
    else storage.removeItem(settingsStorageKeys.quickRandomPattern);
  };

  const saveRandomTrainingPatternPresets = (presetIds: string[]) => {
    storage.setItem(settingsStorageKeys.randomTrainingPatternPresets, JSON.stringify(presetIds));
  };

  const saveQuickRandomMode = (mode: "free" | "blind") => {
    storage.setItem(settingsStorageKeys.quickRandomMode, mode);
  };

  const loadReasonTagPreferences = (): ReasonTagPreferences => {
    try {
      const storedReasonTags = readJson(storage, settingsStorageKeys.reasonTags);
      const storedCustomTags = readJson(storage, settingsStorageKeys.customReasonTags);
      const legacyCustomTags = Array.isArray(storedCustomTags) ? storedCustomTags : [];
      const reasonTags = normalizeReasonTags(
        storedReasonTags ?? [...defaultReasonTags, ...legacyCustomTags],
      );
      return {
        reasonTags,
        customReasonTags: reasonTags.filter((tag) => !defaultReasonTags.includes(tag)),
      };
    } catch {
      storage.removeItem(settingsStorageKeys.reasonTags);
      storage.removeItem(settingsStorageKeys.customReasonTags);
      return cloneDefaultReasonTagPreferences();
    }
  };

  const saveReasonTagPreferences = (reasonTags: string[]) => {
    const normalized = normalizeReasonTags(reasonTags);
    const customReasonTags = normalized.filter((tag) => !defaultReasonTags.includes(tag));
    storage.setItem(settingsStorageKeys.reasonTags, JSON.stringify(normalized));
    storage.setItem(settingsStorageKeys.customReasonTags, JSON.stringify(customReasonTags));
  };

  // This key is retained only for one-time migration from older browser
  // builds. Custom pattern presets now go through /api/preferences and the
  // local D1 database; random-training controls remain browser-local.
  const removeLegacyCustomPatternPresets = () => {
    storage.removeItem(settingsStorageKeys.patternPresets);
  };

  const removeLegacyReasonTagPreferences = () => {
    storage.removeItem(settingsStorageKeys.reasonTags);
    storage.removeItem(settingsStorageKeys.customReasonTags);
  };

  const loadMovingAverageSettings = (): MovingAverageSettings => {
    const stored = storage.getItem(settingsStorageKeys.movingAverageSettings);
    if (stored == null) return normalizeMovingAverageSettings(defaultMovingAverageSettings);
    try {
      return normalizeMovingAverageSettings(JSON.parse(stored));
    } catch {
      storage.removeItem(settingsStorageKeys.movingAverageSettings);
      return normalizeMovingAverageSettings(defaultMovingAverageSettings);
    }
  };

  const saveMovingAverageSettings = (settings: MovingAverageSettings) => {
    storage.setItem(settingsStorageKeys.movingAverageSettings, JSON.stringify(normalizeMovingAverageSettings(settings)));
  };

  const saveLastDraft = <T>(draft: T) => {
    storage.setItem(settingsStorageKeys.lastDraft, JSON.stringify(draft));
  };

  const loadLastDraft = <T>(): T | null => {
    const stored = storage.getItem(settingsStorageKeys.lastDraft);
    if (stored == null) return null;
    try {
      return JSON.parse(stored) as T;
    } catch {
      storage.removeItem(settingsStorageKeys.lastDraft);
      return null;
    }
  };

  const removeLastDraft = () => {
    storage.removeItem(settingsStorageKeys.lastDraft);
  };

  return {
    loadAppSettings,
    saveAppSettings,
    loadHiddenPatternPresetIds,
    saveHiddenPatternPresetIds,
    loadPatternPreferences,
    savePatternPresets,
    saveQuickRandomPattern,
    saveRandomTrainingPatternPresets,
    saveQuickRandomMode,
    loadReasonTagPreferences,
    saveReasonTagPreferences,
    removeLegacyCustomPatternPresets,
    removeLegacyReasonTagPreferences,
    loadMovingAverageSettings,
    saveMovingAverageSettings,
    saveLastDraft,
    loadLastDraft,
    removeLastDraft,
  };
}

export function createPreferencesGateway(fetcher: SettingsFetch) {
  let mutationGeneration = 0;
  let saveTail: Promise<void> = Promise.resolve();

  const load = async (signal?: AbortSignal) => {
    // A focus/visibility refresh must not read the old server value while a
    // local edit is still queued behind an earlier preference write.
    await saveTail.catch(() => undefined);
    const generationAtStart = mutationGeneration;
    const response = await fetcher("/api/preferences", {
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    if (generationAtStart !== mutationGeneration) return undefined;
    if (!response.ok) throw new Error("读取同步设置失败");
    const payload = await response.json();
    if (generationAtStart !== mutationGeneration) return undefined;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
    return (payload as { preferences?: unknown }).preferences;
  };

  const write = async (preferences: unknown, signal?: AbortSignal) => {
    const response = await fetcher("/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preferences),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error("保存同步设置失败");
  };

  const save = (preferences: unknown, signal?: AbortSignal) => {
    mutationGeneration += 1;
    const pendingSave = saveTail
      .catch(() => undefined)
      .then(() => write(preferences, signal));
    saveTail = pendingSave;
    return pendingSave;
  };

  return { load, save };
}
