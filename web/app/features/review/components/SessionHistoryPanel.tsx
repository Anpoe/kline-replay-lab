import { RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  defaultReviewSessionFilters,
  type ReviewSessionFilters,
} from "../reviewContracts";
import {
  nextReviewSessionVisibleCount,
  REVIEW_SESSION_PAGE_SIZE,
  visibleReviewSessionItems,
} from "../reviewController";
import { timeframeLabel } from "../../../lib/timeframeCatalog";

export type SessionHistoryItem = {
  id: string;
  instrumentId: string;
  timeframe: string;
  completed: boolean;
  modeLabel: string;
  rangeLabel: string;
  patternLabel?: string;
  progressLabel?: string;
  tradingMode: "return" | "capital";
  totalValue: string;
  realizedValue: string;
  floatingValue: string;
  totalTone: "up" | "down";
  openPositions: number;
  closedPositions: number;
  winningTrades: number;
  losingTrades: number;
  flatTrades: number;
  createdAtLabel: string;
  selected: boolean;
};

export type AuditEventItem = {
  id: string;
  sequence: number;
  label: string;
  occurredAtLabel: string;
};

type SessionHistoryPanelProps = {
  items: readonly SessionHistoryItem[];
  totalCount: number;
  filters: ReviewSessionFilters;
  timeframes: readonly string[];
  modeOptions: readonly string[];
  auditEvents: readonly AuditEventItem[];
  emptyText: string;
  onFilterChange: (update: Partial<ReviewSessionFilters>) => void;
  onResetFilters: () => void;
  onReview: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  emptyActivityCount: number;
  batchDeleteRunning: boolean;
  onDeleteEmpty: () => void;
  onDeleteSelected: (ids: string[]) => void;
  cleanupStatus: string;
};

export function SessionHistoryPanel({
  items,
  totalCount,
  filters,
  timeframes,
  modeOptions,
  auditEvents,
  emptyText,
  onFilterChange,
  onResetFilters,
  onReview,
  onResume,
  onDelete,
  emptyActivityCount,
  batchDeleteRunning,
  onDeleteEmpty,
  onDeleteSelected,
  cleanupStatus,
}: SessionHistoryPanelProps) {
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const selectionScope = JSON.stringify(filters);
  const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope: selectionScope, ids: [] });
  const selectedIds = new Set(selection.scope === selectionScope ? selection.ids : []);
  const selectedItems = items.filter((item) => selectedIds.has(item.id));
  const allSelected = items.length > 0 && selectedItems.length === items.length;
  const toggleSelection = (id: string) => {
    if (batchDeleteRunning) return;
    const ids = new Set(selectedItems.map((item) => item.id));
    if (ids.has(id)) ids.delete(id); else ids.add(id);
    setSelection({ scope: selectionScope, ids: [...ids] });
  };
  const [visibleState, setVisibleState] = useState<{
    items: readonly SessionHistoryItem[];
    count: number;
  }>({ items, count: REVIEW_SESSION_PAGE_SIZE });
  const filtersAreDefault = Object.entries(filters).every(([key, value]) => (
    value === defaultReviewSessionFilters[key as keyof ReviewSessionFilters]
  ));
  const visibleItemCount = visibleState.items === items ? visibleState.count : REVIEW_SESSION_PAGE_SIZE;
  const visibleItems = visibleReviewSessionItems(items, visibleItemCount);
  const canLoadMore = visibleItems.length < items.length;

  return (
    <>
      <article className="history-card">
        <div className="history-card-head">
          <div>
            <div className="section-label">可恢复训练</div>
            <strong>{items.length} / {totalCount} 场</strong>
          </div>
          <div className="history-card-head-actions">
            <button
              type="button"
              className="delete-session history-batch-delete"
              aria-expanded={cleanupOpen}
              aria-controls="history-cleanup-actions"
              onClick={() => {
                setCleanupOpen(!cleanupOpen);
                setSelection({ scope: selectionScope, ids: [] });
              }}
              disabled={batchDeleteRunning}
            >
              <Trash2 size={13} />{batchDeleteRunning ? "清理中…" : "清理"}
            </button>
            <button type="button" className="history-filter-reset" onClick={() => { setSelection({ scope: selectionScope, ids: [] }); onResetFilters(); }} disabled={filtersAreDefault}>清除筛选</button>
          </div>
        </div>
        {cleanupOpen && (
          <div className="history-cleanup-actions" id="history-cleanup-actions" role="group" aria-label="清理训练">
            <button type="button" className="history-filter-reset" disabled={batchDeleteRunning || !items.length}
              title="选择当前筛选下的全部训练，包括尚未展开的记录"
              aria-label="全选当前筛选下的全部训练，包括尚未展开的记录"
              onClick={() => setSelection({ scope: selectionScope, ids: allSelected ? [] : items.map((item) => item.id) })}>
              {allSelected ? "取消全选" : "全选"}
            </button>
            <button type="button" className="delete-session" onClick={onDeleteEmpty} disabled={batchDeleteRunning || emptyActivityCount === 0}
              title="只清理当前筛选中没有画图、决策、委托或成交的训练"
              aria-label={`清理当前筛选中没有画图、决策、委托或成交的训练，共 ${emptyActivityCount} 场`}>
              清理无操作（{emptyActivityCount}）
            </button>
            <button type="button" className="delete-session" disabled={batchDeleteRunning || !selectedItems.length}
              onClick={() => onDeleteSelected(selectedItems.map((item) => item.id))}>
              <Trash2 size={13} />删除所选（{selectedItems.length}）
            </button>
            <button type="button" className="history-filter-reset" disabled={batchDeleteRunning}
              onClick={() => { setCleanupOpen(false); setSelection({ scope: selectionScope, ids: [] }); }}>完成</button>
          </div>
        )}
        {cleanupStatus && <div className="history-cleanup-status" role="status">{cleanupStatus}</div>}
        <div className="review-session-filters">
          <label className="review-session-search">
            <span>搜索</span>
            <input
              value={filters.query}
              onChange={(event) => { setSelection({ scope: selectionScope, ids: [] }); onFilterChange({ query: event.target.value }); }}
              placeholder="代码、模式或形态"
            />
          </label>
          <label>
            <span>周期</span>
            <select value={filters.timeframe} onChange={(event) => { setSelection({ scope: selectionScope, ids: [] }); onFilterChange({ timeframe: event.target.value }); }}>
              <option value="all">全部周期</option>
              {timeframes.map((value) => <option key={value} value={value}>{timeframeLabel(value)}</option>)}
            </select>
          </label>
          <label>
            <span>模式</span>
            <select value={filters.modeLabel} onChange={(event) => { setSelection({ scope: selectionScope, ids: [] }); onFilterChange({ modeLabel: event.target.value }); }}>
              <option value="all">全部模式</option>
              {modeOptions.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>状态</span>
            <select value={filters.status} onChange={(event) => { setSelection({ scope: selectionScope, ids: [] }); onFilterChange({ status: event.target.value as ReviewSessionFilters["status"] }); }}>
              <option value="all">全部状态</option>
              <option value="completed">已完成</option>
              <option value="active">可继续</option>
            </select>
          </label>
          <label>
            <span>事前计划</span>
            <select value={filters.planStatus} onChange={(event) => { setSelection({ scope: selectionScope, ids: [] }); onFilterChange({ planStatus: event.target.value as ReviewSessionFilters["planStatus"] }); }}>
              <option value="all">全部计划</option>
              <option value="written">已写计划</option>
              <option value="unwritten">未写计划</option>
            </select>
          </label>
        </div>
        <div className="review-session-scroll" tabIndex={0} aria-label="全部可恢复训练，可滚动浏览">
          {visibleItems.length ? visibleItems.map((item) => (
            <div
              className={`session-row ${item.selected ? "active" : ""} ${cleanupOpen ? "cleanup-selectable" : ""}`}
              key={item.id}
              role="button"
              tabIndex={0}
              aria-label={`${cleanupOpen ? "选择" : "查看"} ${item.instrumentId} ${timeframeLabel(item.timeframe)} ${cleanupOpen ? "训练" : "复盘"}`}
              onClick={() => cleanupOpen ? toggleSelection(item.id) : onReview(item.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  if (cleanupOpen) toggleSelection(item.id); else onReview(item.id);
                }
              }}
            >
              {cleanupOpen && (
                <label className="history-session-select" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                  <input type="checkbox" checked={selectedIds.has(item.id)} disabled={batchDeleteRunning}
                    aria-label={`选择 ${item.instrumentId} ${timeframeLabel(item.timeframe)} ${item.createdAtLabel} 的训练`}
                    onChange={() => toggleSelection(item.id)} />
                </label>
              )}
              <div className="session-main">
                <div className="session-title">
                  <strong>{item.instrumentId} · {timeframeLabel(item.timeframe)}</strong>
                  <span className={item.completed ? "session-status completed" : "session-status"}>
                    {item.completed ? "已完成" : "已保存，可继续"}
                  </span>
                </div>
                <div className="session-tags">
                  <span>{item.modeLabel}</span>
                  <span>{item.rangeLabel}</span>
                  {item.patternLabel && <span>形态：{item.patternLabel}</span>}
                  {item.progressLabel && <span>进度 {item.progressLabel}</span>}
                </div>
                <div className="session-pnl">
                  <span>{item.tradingMode === "capital" ? "总盈亏" : "总收益率"}<strong className={item.totalTone}>{item.totalValue}</strong></span>
                  <span>{item.tradingMode === "capital" ? "已实现" : "已实现收益率"}<strong>{item.realizedValue}</strong></span>
                  <span>{item.tradingMode === "capital" ? "浮动" : "浮动收益率"}<strong>{item.floatingValue}</strong></span>
                  <span>{item.openPositions} 笔持仓 · {item.closedPositions} 笔平仓</span>
                  <span>已平仓交易 {item.winningTrades} 胜 / {item.losingTrades} 负 / {item.flatTrades} 平</span>
                </div>
                <small>创建时间 {item.createdAtLabel}</small>
              </div>
              <div
                className="session-actions"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <button className="resume-session" disabled={batchDeleteRunning} onClick={() => onResume(item.id)}><RotateCcw size={13} />继续训练</button>
                <button className="delete-session" disabled={batchDeleteRunning} aria-label={`将 ${item.instrumentId} 训练移入回收站`} onClick={() => onDelete(item.id)}><Trash2 size={13} />移入回收站</button>
              </div>
            </div>
          )) : <div className="empty-state">{emptyText}</div>}
          {canLoadMore && (
            <button
              type="button"
              className="review-session-load-more"
              onClick={() => setVisibleState({
                items,
                count: nextReviewSessionVisibleCount(visibleItemCount, items.length),
              })}
            >
              加载更多历史（已显示 {visibleItems.length} / {items.length}）
            </button>
          )}
        </div>
      </article>
      <details className="audit-timeline">
        <summary>
          <span><span className="section-label">操作时间线</span><strong>{auditEvents.length} 条记录</strong></span>
          <small>用于追溯训练过程，点击展开</small>
        </summary>
        <div className="audit-event-list">
          {auditEvents.map((event) => (
            <div className="audit-event" key={event.id}>
              <span>#{event.sequence}</span>
              <div><strong>{event.label}</strong><small>{event.occurredAtLabel}</small></div>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}
