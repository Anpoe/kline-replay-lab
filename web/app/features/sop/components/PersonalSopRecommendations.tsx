import { useEffect, useRef, useState } from "react";
import type {
  PersonalSopRecommendation,
  PersonalSopScopeSummary,
  PersonalSopRule,
} from "../../../lib/performanceSop";
import { timeframeLabel } from "../../../lib/timeframeCatalog";
import { filterPersonalSopRecommendations, personalSopScopeKey } from "../sopController";

export type PersonalSopRecommendationsProps = {
  recommendations: PersonalSopRecommendation[];
  scopeSummaries: PersonalSopScopeSummary[];
  activeRule: Pick<PersonalSopRule, "id" | "scope"> | null;
  formatResult: (value: number) => string;
  onApply: (recommendation: PersonalSopRecommendation) => void;
};

function scopeLabel(summary: Pick<PersonalSopScopeSummary, "market" | "timeframe">) {
  const label = timeframeLabel(summary.timeframe);
  if (summary.market === "US") return `美股 ${label}`;
  if (summary.market === "CN") return `A股 ${label}`;
  if (summary.market === "FX") return `EURUSD / 外汇 ${label}`;
  return `${summary.market} ${label}`;
}

function rangeLabel(range: { label: string } | undefined) {
  return range?.label ?? "资料不足，暂不设硬条件";
}

function statsLabel(recommendation: PersonalSopRecommendation, formatResult: (value: number) => string) {
  const pf = recommendation.stats.profitFactor === Number.POSITIVE_INFINITY
    ? "∞"
    : recommendation.stats.profitFactor == null
      ? "--"
      : recommendation.stats.profitFactor.toFixed(2);
  const drawdown = recommendation.stats.maxDrawdown > 0
    ? formatResult(-recommendation.stats.maxDrawdown)
    : "0.00%";
  return `${recommendation.stats.samples} 笔 · 胜率 ${recommendation.stats.winRate}% · PF ${pf} · 期望 ${formatResult(recommendation.stats.expectancy)} / 笔 · 最大回撤 ${drawdown}`;
}

export function PersonalSopRecommendations({
  recommendations,
  scopeSummaries,
  activeRule,
  formatResult,
  onApply,
}: PersonalSopRecommendationsProps) {
  const [selectedScopeKey, setSelectedScopeKey] = useState(() => (
    activeRule
      ? personalSopScopeKey(activeRule.scope)
      : personalSopScopeKey(scopeSummaries[0] ?? { market: "US", timeframe: "1d" })
  ));
  const lastActiveRuleIdRef = useRef(activeRule?.id ?? "");
  useEffect(() => {
    const activeRuleId = activeRule?.id ?? "";
    if (activeRuleId && activeRuleId !== lastActiveRuleIdRef.current && activeRule) {
      setSelectedScopeKey(personalSopScopeKey(activeRule.scope));
    }
    lastActiveRuleIdRef.current = activeRuleId;
  }, [activeRule]);
  const effectiveSelectedScopeKey = scopeSummaries.some((summary) => personalSopScopeKey(summary) === selectedScopeKey)
    ? selectedScopeKey
    : scopeSummaries[0] ? personalSopScopeKey(scopeSummaries[0]) : "";
  const selectedSummary = scopeSummaries.find((summary) => personalSopScopeKey(summary) === effectiveSelectedScopeKey);
  const visibleRecommendations = selectedSummary
    ? filterPersonalSopRecommendations(recommendations, selectedSummary)
    : recommendations;
  const activeScopeKey = activeRule ? personalSopScopeKey(activeRule.scope) : "";

  return (
    <section className="personal-sop-recommendations">
      <div className="performance-section-head">
        <div><span className="section-label">PERSONAL SOP</span><h2>个人 SOP 推荐</h2></div>
        <small>点击上方市场/周期卡切换查看；下方最多展示 3 个组合。至少 15 笔样本、期望收益为正且 PF &gt; 1 才可采用，其他组合保留为观察候选。</small>
      </div>

      <div className="personal-sop-scope-status" role="tablist" aria-label="个人 SOP 市场范围">
        {scopeSummaries.map((summary) => (
          <button
            key={`${summary.market}-${summary.timeframe}`}
            type="button"
            className={`${summary.eligible ? "eligible" : "pending"}${personalSopScopeKey(summary) === effectiveSelectedScopeKey ? " selected" : ""}`}
            aria-pressed={personalSopScopeKey(summary) === effectiveSelectedScopeKey}
            onClick={() => setSelectedScopeKey(personalSopScopeKey(summary))}
          >
            <span>{scopeLabel(summary)}</span>
            <strong>{summary.samples} / 15 笔</strong>
            <small>{summary.eligible ? "范围样本已达标" : `范围还差 ${summary.missingSamples} 笔`}</small>
          </button>
        ))}
      </div>

      {activeRule && activeScopeKey !== effectiveSelectedScopeKey && (
        <div className="personal-sop-scope-hint">当前激活规则：{scopeLabel(activeRule.scope)}。这里切换的是查看范围；采用另一条候选后，当前规则才会切换。</div>
      )}

      {visibleRecommendations.length ? (
        <div className="personal-sop-card-list">
          {visibleRecommendations.map((recommendation) => {
            const active = activeRule?.id === recommendation.id;
            return (
              <article className={`personal-sop-card${active ? " active" : ""}${recommendation.adoptable ? "" : " unavailable"}`} key={recommendation.id}>
                <header>
                  <div>
                    <span>{active
                      ? "当前激活"
                      : recommendation.adoptable
                        ? "可采用"
                        : !recommendation.eligible
                          ? `暂不可采用 · 还差 ${recommendation.missingSamples} 笔`
                          : "暂不可采用 · 未形成正期望"}</span>
                    <h3>{recommendation.title}</h3>
                  </div>
                  <button
                    type="button"
                    className={active ? "ghost-button" : "primary-button"}
                    disabled={!recommendation.adoptable || active}
                    onClick={() => onApply(recommendation)}
                  >{active ? "已采用" : recommendation.adoptable ? "采用为当前 SOP" : "暂不可采用"}</button>
                </header>
                <p className="personal-sop-stat-line">{statsLabel(recommendation, formatResult)}</p>
                <div className="personal-sop-condition-grid">
                  <div><span>入场语境</span><strong>{recommendation.conditions.patterns.join(" / ") || "未使用形态筛选"} · {recommendation.conditions.marketState || "状态未形成"} · {recommendation.conditions.location || "位置未形成"}</strong><small>理由：{recommendation.conditions.reasons.join(" + ") || "未形成稳定理由"}</small></div>
                  <div><span>品种资料</span><strong>价格 {rangeLabel(recommendation.conditions.priceRange)} · 量 {rangeLabel(recommendation.conditions.volumeRange)}</strong><small>成交额 {rangeLabel(recommendation.conditions.turnoverRange)} · 市值 {rangeLabel(recommendation.conditions.marketCapRange)}</small></div>
                  <div><span>持仓管理</span><strong>允许 {recommendation.management.holdingBarsMin}–{recommendation.management.holdingBarsMax} 根 K 线</strong><small>超过上限提示；严格模式和自动平仓同时开启时排队平仓。</small></div>
                </div>
                <div className="personal-sop-dimension-tags">
                  {recommendation.managedDimensions.map((dimension) => <span className={dimension.mode} key={dimension.key}>{dimension.label} {dimension.mode === "hard" ? "管理" : dimension.mode === "ignore" ? "不限制" : "观察"}</span>)}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="personal-sop-empty">
          <strong>当前范围暂无可归因组合</strong>
          <span>{selectedSummary?.samples
            ? "当前范围有样本，但还没有带交易决策的记录可用于组合统计；继续完成或补写记录。"
            : "当前范围还没有已平仓且带交易决策的样本；系统不会用其他市场或周期的样本凑数。"}</span>
        </div>
      )}
    </section>
  );
}
