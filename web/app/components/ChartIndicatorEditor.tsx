"use client";
import { Plus, X } from "lucide-react";
import { defaultMovingAverageSettings, normalizeMovingAveragePeriods, MIN_MOVING_AVERAGE_PERIOD, MAX_MOVING_AVERAGE_PERIOD, MAX_MOVING_AVERAGE_LINES, type MovingAverageKind, type MovingAverageSettings, type MacdSettings } from "../lib/chartIndicators";

export function ChartIndicatorEditor({
  settings,
  onChange,
  macdSettings,
  onMacdChange,
  compact = false,
}: {
  settings: MovingAverageSettings;
  onChange: (settings: MovingAverageSettings) => void;
  macdSettings: MacdSettings;
  onMacdChange: (settings: MacdSettings) => void;
  compact?: boolean;
}) {
  const updateGroup = (kind: MovingAverageKind, next: MovingAverageSettings[MovingAverageKind]) => {
    onChange({ ...settings, [kind]: next });
  };

  return (
    <div className={`moving-average-editor${compact ? " compact" : ""}`}>
      {(["ma", "ema"] as MovingAverageKind[]).map((kind) => {
        const group = settings[kind];
        const label = kind.toUpperCase();
        return (
          <section className={group.enabled ? "enabled" : ""} key={kind}>
            <div className="moving-average-row-head">
              <button
                type="button"
                className="indicator-switch"
                role="switch"
                aria-checked={group.enabled}
                aria-label={`${label} 指标`} title={`${kind === "ma" ? "简单移动平均" : "指数移动平均"}；周期 1–500，最多 6 条；仅用已加载 K 线计算`}
                onClick={() => updateGroup(kind, { ...group, enabled: !group.enabled })}
              ><span />{label}</button>

            </div>
            <div className="indicator-period-list" aria-label={`${label} 周期`}>
              {group.periods.map((period, index) => (
                <label key={`${kind}-${index}`}>
                  <span>{label}{index + 1}</span>
                  <input
                    type="number"
                    min={MIN_MOVING_AVERAGE_PERIOD}
                    max={MAX_MOVING_AVERAGE_PERIOD}
                    value={period}
                    aria-label={`${label} 周期 ${index + 1}`}
                    onChange={(event) => {
                      const nextPeriods = [...group.periods];
                      nextPeriods[index] = Math.min(
                        MAX_MOVING_AVERAGE_PERIOD,
                        Math.max(MIN_MOVING_AVERAGE_PERIOD, Math.round(Number(event.target.value) || 1)),
                      );
                      updateGroup(kind, { ...group, periods: nextPeriods });
                    }}
                    onBlur={() => updateGroup(kind, {
                      ...group,
                      periods: normalizeMovingAveragePeriods(group.periods, defaultMovingAverageSettings[kind].periods),
                    })}
                  />
                  <button
                    type="button"
                    aria-label={`删除 ${label} 周期 ${period}`}
                    disabled={group.periods.length === 1}
                    onClick={() => updateGroup(kind, {
                      ...group,
                      periods: group.periods.filter((_, periodIndex) => periodIndex !== index),
                    })}
                  ><X size={12} /></button>
                </label>
              ))}
              <button
                type="button"
                className="add-indicator-period"
                disabled={group.periods.length >= MAX_MOVING_AVERAGE_LINES}
                onClick={() => {
                  const last = group.periods.at(-1) ?? 5;
                  const candidate = Math.min(MAX_MOVING_AVERAGE_PERIOD, last + (last < 20 ? 5 : 10));
                  const next = group.periods.includes(candidate)
                    ? Math.min(MAX_MOVING_AVERAGE_PERIOD, candidate + 1)
                    : candidate;
                  updateGroup(kind, { ...group, periods: [...group.periods, next] });
                }}
              ><Plus size={12} />周期</button>
            </div>
          </section>
        );
      })}
      <section className={macdSettings.enabled ? "enabled" : ""}>
        <div className="moving-average-row-head">
          <button
            type="button"
            className="indicator-switch"
            role="switch"
            aria-checked={macdSettings.enabled}
            aria-label="MACD 指标" title="平滑异同移动平均线，显示在副图；周期 1–500；仅用已加载 K 线计算"
            onClick={() => onMacdChange({ ...macdSettings, enabled: !macdSettings.enabled })}
          ><span />MACD</button>

        </div>
        <div className="indicator-period-list" aria-label="MACD 周期">
          {(["快线", "慢线", "信号线"] as const).map((label, index) => (
            <label key={label}>
              <span>{label}</span>
              <input
                type="number"
                min={MIN_MOVING_AVERAGE_PERIOD}
                max={MAX_MOVING_AVERAGE_PERIOD}
                value={macdSettings.periods[index]}
                aria-label={`MACD ${label}周期`}
                onChange={(event) => {
                  const periods = [...macdSettings.periods] as MacdSettings["periods"];
                  periods[index] = Math.min(MAX_MOVING_AVERAGE_PERIOD, Math.max(MIN_MOVING_AVERAGE_PERIOD, Math.round(Number(event.target.value) || 1)));
                  onMacdChange({ ...macdSettings, periods });
                }}
              />
            </label>
          ))}
        </div>
      </section>

    </div>
  );
}
