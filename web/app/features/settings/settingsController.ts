import {
  normalizeSettings,
  type AppSettings,
} from "./settingsContracts.ts";

export type SettingsSaveResult =
  | { ok: true; settings: AppSettings }
  | { ok: false; error: string };

export type SettingsPersistence = {
  write: (settings: AppSettings) => void;
};

/** Validate the settings boundary before the shell applies side effects. */
export function prepareSettingsSave(draft: Partial<AppSettings>): SettingsSaveResult {
  if (
    draft.randomDateMode === "range"
    && (!draft.randomStartDate || !draft.randomEndDate)
  ) {
    return { ok: false, error: "随机时间段需要填写开始和结束日期。" };
  }
  if (
    draft.randomDateMode === "range"
    && Boolean(draft.randomStartDate)
    && Boolean(draft.randomEndDate)
    && (draft.randomEndDate as string) < (draft.randomStartDate as string)
  ) {
    return { ok: false, error: "随机时间段的结束日期不能早于开始日期。" };
  }
  return { ok: true, settings: normalizeSettings(draft) };
}

/** Keep persistence as an injected adapter so the feature never owns storage. */
export function persistSettingsSave(
  draft: Partial<AppSettings>,
  persistence: SettingsPersistence,
): SettingsSaveResult {
  const result = prepareSettingsSave(draft);
  if (!result.ok) return result;
  persistence.write(result.settings);
  return result;
}

export function updateSettings(
  settings: AppSettings,
  update: Partial<AppSettings>,
): AppSettings {
  return normalizeSettings({ ...settings, ...update });
}
