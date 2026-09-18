import type { DeterministicReviewMetrics } from "../../../lib/reviewMetrics";
import type { ExecutionReason } from "../../../lib/executionEngine";
import { ListFilter, Settings2 } from "lucide-react";

type ReviewSummary = {
  heroLabel: string;
  heroValue: string;
  heroTone: "up" | "down";
  heroMeta: string;
  tradeWinRate: number;
  tradeMeta: string;
  submittedPlans: number;
  resultValue: string;
  resultTone: "up" | "down";
  resultMeta: string;
};

type ReviewPanelProps = {
  title: string;
  summary: ReviewSummary;
  hasReviewedSession: boolean;
  reviewMetrics?: DeterministicReviewMetrics;
  timeframe: string;
  onOpenPatternFilters: () => void;
  onOpenSettings: () => void;
  linkedDecisionLabel: (id: string | undefined) => string | undefined;
  onBack: () => void;
  onEvidence: (timestamp: number, label: string) => void;
  formatDate: (timestamp: number, timeframe: string) => string;
  money: (value: number) => string;
  percent: (value: number) => string;
  profitFactorLabel: (value: number | null, infinite?: boolean) => string;
  exitReasonLabel: (value: ExecutionReason | undefined) => string;
};

export function ReviewPanel({
  title,
  summary,
  hasReviewedSession,
  reviewMetrics,
  timeframe,
  onOpenPatternFilters,
  onOpenSettings,
  linkedDecisionLabel,
  onBack,
  onEvidence,
  formatDate,
  money,
  percent,
  profitFactorLabel,
  exitReasonLabel,
}: ReviewPanelProps) {
  return (
    <>
      <div className="page-heading">
        <div><span>REVIEW</span><h1>训练复盘</h1><p>{title} · 先看事前计划，再判断执行质量。</p></div>
        {hasReviewedSession && <button className="ghost-button" onClick={onBack}>返回当前训练</button>}
      </div>
      <div className="review-utility-bar" aria-label="复盘工具">
        <div className="review-utility-copy">
          <span>REVIEW TOOLS</span>
          <strong>复盘工具</strong>
          <small>管理形态筛选与训练设置</small>
        </div>
        <div className="review-utility-actions">
          <button type="button" className="ghost-button" onClick={onOpenPatternFilters}><ListFilter size={15} />形态筛选</button>
          <button type="button" className="ghost-button" onClick={onOpenSettings}><Settings2 size={15} />设置</button>
        </div>
      </div>
      <div className="review-grid">
        <div className="review-hero">
          <span>{summary.heroLabel}</span><strong className={summary.heroTone}>{summary.heroValue}</strong><small>{summary.heroMeta}</small>
        </div>
        <div className="metric-card"><span>本场按交易胜率</span><strong>{summary.tradeWinRate}%</strong><small>{summary.tradeMeta}</small></div>
        <div className="metric-card"><span>已提交计划</span><strong>{summary.submittedPlans}</strong><small>每次提交均绑定原始K线</small></div>
        <div className="metric-card"><span>本场训练结果</span><strong className={summary.resultTone}>{summary.resultValue}</strong><small>{summary.resultMeta}</small></div>
      </div>
      <article className="deterministic-review-card">
        <div className="performance-section-head">
          <div><span className="section-label">确定性指标 · {reviewMetrics?.version ?? "历史记录"}</span><h2>每个结果都能回到原始 K 线</h2></div>
          <small>{reviewMetrics
            ? `${reviewMetrics.generatedFromBarCount} 根证据 K 线 · ${reviewMetrics.evidenceComplete ? "证据完整" : "部分记录缺少入场/出场 K 线"}`
            : "这份训练保存时尚未生成确定性指标；继续训练并重新保存后会补齐。"}</small>
        </div>
        {reviewMetrics ? (
          <>
            <div className="deterministic-metrics-grid">
              <div><span>期望值 / 笔</span><strong className={reviewMetrics.expectancy >= 0 ? "up" : "down"}>{money(reviewMetrics.expectancy)}</strong><small>{reviewMetrics.expectancyR == null ? "无初始止损，无法计算 R" : `${reviewMetrics.expectancyR.toFixed(2)}R`}</small></div>
              <div><span>平均 R</span><strong>{reviewMetrics.averageR == null ? "—" : `${reviewMetrics.averageR.toFixed(2)}R`}</strong><small>{reviewMetrics.rQualifiedTrades} / {reviewMetrics.closedTrades} 笔有冻结初始风险</small></div>
              <div><span>盈亏比 / PF</span><strong>{reviewMetrics.payoffRatio == null ? "—" : reviewMetrics.payoffRatio.toFixed(2)} / {profitFactorLabel(reviewMetrics.profitFactor, reviewMetrics.profitFactorInfinite)}</strong><small>平均赢 {money(reviewMetrics.averageWin)} · 平均亏 {money(-reviewMetrics.averageLoss)}</small></div>
              <div><span>最大回撤</span><strong className="down">{money(-reviewMetrics.maxDrawdown)}</strong><small>{reviewMetrics.maxDrawdownPct.toFixed(2)}% · 水下最长 {reviewMetrics.maxUnderwaterBars} 根</small></div>
              <div><span>交易成本</span><strong>{reviewMetrics.fees.toFixed(2)}</strong><small>毛盈亏 {money(reviewMetrics.grossPnl)} · 净盈亏 {money(reviewMetrics.netPnl)}</small></div>
              <div><span>最大连续亏损</span><strong>{reviewMetrics.maxConsecutiveLosses}</strong><small>按平仓先后顺序计算</small></div>
            </div>
            <div className="deterministic-trades-wrap">
              <table className="orders-table deterministic-trades-table">
                <thead><tr><th>仓位</th><th>入场 → 出场</th><th>净盈亏 / R</th><th>MFE / MAE</th><th>出场效率</th><th>后续 1/3/5/10 根</th><th>证据</th></tr></thead>
                <tbody>{reviewMetrics.trades.length ? reviewMetrics.trades.map((trade) => {
                  const linkedDecision = linkedDecisionLabel(trade.decisionSubmissionId);
                  return (
                    <tr key={trade.positionId}>
                      <td data-label="仓位"><span className="position-id">#{trade.positionId.slice(0, 6)}</span><small>{trade.side === "long" ? "多" : "空"} · {trade.holdingBars} 根</small><small>{linkedDecision ? `计划 · ${linkedDecision}` : "未明确关联计划"}</small></td>
                      <td data-label="入场 → 出场"><button type="button" className="evidence-link" onClick={() => onEvidence(trade.entryTimestamp, "入场")}>{formatDate(trade.entryTimestamp, timeframe)}</button> → <button type="button" className="evidence-link" onClick={() => onEvidence(trade.exitTimestamp, "出场")}>{formatDate(trade.exitTimestamp, timeframe)}</button><small>{trade.entryPrice.toFixed(2)} → {trade.exitPrice.toFixed(2)} · {exitReasonLabel(trade.exitReason as ExecutionReason | undefined)}</small></td>
                      <td data-label="净盈亏 / R"><strong className={trade.netPnl >= 0 ? "up" : "down"}>{money(trade.netPnl)}</strong><small>{trade.rMultiple == null ? "R —" : `${trade.rMultiple.toFixed(2)}R`} · 费 {trade.fees.toFixed(2)}</small></td>
                      <td data-label="MFE / MAE"><strong>{money(trade.mfe)} / {money(trade.mae)}</strong><small><button type="button" className="evidence-link" onClick={() => onEvidence(trade.mfeTimestamp, "MFE")}>{formatDate(trade.mfeTimestamp, timeframe)}</button> / <button type="button" className="evidence-link" onClick={() => onEvidence(trade.maeTimestamp, "MAE")}>{formatDate(trade.maeTimestamp, timeframe)}</button></small></td>
                      <td data-label="出场效率">{trade.exitEfficiencyPct == null ? "—" : `${trade.exitEfficiencyPct.toFixed(1)}%`}<small>{trade.intrabarAmbiguous ? "止损止盈同根冲突" : "无同根冲突"}</small></td>
                      <td data-label="后续 K 线">{trade.horizons.map((horizon) => horizon.returnPct == null ? `${horizon.bars}: —` : `${horizon.bars}: ${percent(horizon.returnPct)}`).join(" · ")}</td>
                      <td data-label="证据"><span className={trade.evidenceComplete ? "evidence-ok" : "evidence-missing"}>{trade.evidenceComplete ? "完整" : "缺失"}</span></td>
                    </tr>
                  );
                }) : <tr><td className="orders-empty" colSpan={7}>还没有已平仓交易；有成交后会生成逐笔证据。</td></tr>}</tbody>
              </table>
            </div>
          </>
        ) : <div className="empty-state">旧保存点没有指标快照，系统不会用估算值冒充确定性结果。</div>}
      </article>
    </>
  );
}
