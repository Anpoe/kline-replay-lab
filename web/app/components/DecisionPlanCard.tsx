"use client";
import type { ReactNode, Ref } from "react";
import { ListChecks, Pencil, Save, Sparkles, Trash2, TrendingUp, X } from "lucide-react";
import { decisionPlanStatus } from "../lib/decisionWorkflow";
import { decisionPlanScore, type DecisionPlanValue } from "../lib/decisionPlan";

export type ReasonTagEditorControls = {
  mode: "" | "edit" | "delete"; onMode: (mode: "" | "edit" | "delete") => void;
  editingTag: string; editingValue: string; onStartEdit: (tag: string) => void; onEditValue: (value: string) => void; onSaveEdit: () => void; onCancelEdit: () => void;
  customValue: string; onCustomValue: (value: string) => void; onAdd: () => void; onDelete: (tag: string) => void;
};
export function DecisionPlanCard({ value, onChange, reasonTags, reasonEditor, title = "事前决策卡", hint, notice,
  context, status, history, footer, className = "decision-panel", id, panelRef,
  hidePrice = false, selectedPrice, onPickPrice, onDrawPosition, hasPosition, drawingDisabled, submitLabel, submitDisabled, onSubmit }: {
  value: DecisionPlanValue; onChange: (changes: Partial<DecisionPlanValue>) => void; reasonTags: readonly string[]; reasonEditor: ReasonTagEditorControls;
  title?: string; hint?: string; notice?: string; context?: ReactNode; status?: ReactNode; history?: ReactNode; footer?: ReactNode;
  className?: string; id?: string; panelRef?: Ref<HTMLElement>; hidePrice?: boolean;
  selectedPrice?: string | null; onPickPrice: (kind: "stop-loss" | "take-profit") => void; onDrawPosition: () => void;
  hasPosition?: boolean; drawingDisabled?: boolean; submitLabel: string; submitDisabled?: boolean; onSubmit: () => void;
}) {
  const editor = reasonEditor;
  const mode = (next: "edit" | "delete") => { editor.onMode(editor.mode === next ? "" : next); editor.onCancelEdit(); };
  return <aside className={`${className} shared-decision-card`} id={id} ref={panelRef} aria-label="事前决策卡" data-shared-decision-card>
    <header className="panel-title"><div><h2 title={hint}>{title}</h2><strong title="市场、位置、止损和目标各15分，前两个独立理由各20分；衡量填写完整度" aria-label={`决策完成度 ${decisionPlanScore(value)}%`}>{decisionPlanScore(value)}%</strong></div>{notice && <p>{notice}</p>}</header>
    {context}
    <div className="decision-form-fields"><label>市场状态<select aria-label="市场状态" value={value.marketState} onChange={e => onChange({ marketState: e.target.value })}>
      <option value="">请选择市场状态</option>{["趋势", "宽通道", "震荡区间", "突破模式", "反转尝试"].map(v => <option key={v}>{v}</option>)}</select></label>
      <label>当前位置<select aria-label="当前位置" value={value.location} onChange={e => onChange({ location: e.target.value })}><option value="">请选择当前位置</option>{["回调位置", "区间上沿", "区间中部", "区间下沿", "关键突破位"].map(v => <option key={v}>{v}</option>)}</select></label></div>
    <fieldset><legend><span title="选择至少两个独立理由可获得完整理由评分" aria-label="交易理由，至少两个独立理由可获得完整理由评分">交易理由</span><span className="reason-tag-management" aria-label="交易理由标签管理">
      <button type="button" aria-label="编辑交易理由标签" title="编辑标签：再点击一个标签" aria-pressed={editor.mode === "edit"} className={editor.mode === "edit" ? "active" : ""} onClick={() => mode("edit")}><Pencil size={12} /></button>
      <button type="button" aria-label="删除交易理由标签" title="删除标签：再点击标签旁的删除按钮" aria-pressed={editor.mode === "delete"} className={editor.mode === "delete" ? "active danger" : ""} onClick={() => mode("delete")}><Trash2 size={12} /></button></span></legend>
      <div className="reason-chips">{reasonTags.map(reason => editor.editingTag === reason
        ? <form className="reason-tag-editor" key={reason} onSubmit={e => { e.preventDefault(); editor.onSaveEdit(); }}><input aria-label={`编辑交易理由标签 ${reason}`} maxLength={20} autoFocus value={editor.editingValue} onChange={e => editor.onEditValue(e.target.value)} />
          <button type="submit" aria-label="保存交易理由标签" title="保存"><Save size={12} /></button><button type="button" aria-label="取消编辑交易理由标签" title="取消" onClick={editor.onCancelEdit}><X size={12} /></button></form>
        : <span className={`reason-chip-wrap${editor.mode === "delete" ? " delete-mode" : ""}`} key={reason}><button type="button" aria-label={reason} aria-pressed={value.reasons.includes(reason)} className={value.reasons.includes(reason) ? "selected" : ""}
          onClick={() => { if (editor.mode === "edit") editor.onStartEdit(reason); else if (!editor.mode) onChange({ reasons: value.reasons.includes(reason) ? value.reasons.filter(r => r !== reason) : [...value.reasons, reason] }); }}>{value.reasons.includes(reason) ? "✓ " : "+ "}{reason}</button>
          {editor.mode === "delete" && <button type="button" className="reason-chip-delete" aria-label={`删除交易理由标签 ${reason}`} title="删除标签" onClick={() => editor.onDelete(reason)}><X size={10} /></button>}</span>)}</div>
      <form className="custom-reason-tag" onSubmit={e => { e.preventDefault(); editor.onAdd(); }}><input aria-label="自定义交易理由标签" maxLength={20} placeholder="自定义理由" value={editor.customValue} onChange={e => editor.onCustomValue(e.target.value)} /><button type="submit" disabled={!editor.customValue.trim()}>添加</button></form>
    </fieldset>
    <div className="price-plan">{([{ key: "stop", label: "失效 / 止损", kind: "stop-loss" }, { key: "target", label: "第一目标", kind: "take-profit" }] as const).map(p =>
      <button key={p.key} type="button" disabled={drawingDisabled} aria-pressed={selectedPrice === p.kind} className={`decision-price-level${selectedPrice === p.kind ? " active" : ""}`} onClick={() => onPickPrice(p.kind)}><span>{p.label}</span><strong>{hidePrice ? "已隐藏" : value[p.key] || "点击图表取点"}</strong></button>)}
      <button type="button" disabled={drawingDisabled} aria-pressed={hasPosition} className={`decision-position-draw${hasPosition ? " active" : ""}`} onClick={onDrawPosition}><TrendingUp size={14} />在图表绘制止损 / 目标</button></div>
    <label className="decision-plan-note">计划说明<textarea aria-label="计划说明" maxLength={4000} rows={4} placeholder="我在等待什么？什么情况放弃？" value={value.note} onChange={e => onChange({ note: e.target.value })} /></label>
    <div className="discipline-card" title="评分关注填写与计划过程，不代表胜率，不用结果倒推理由"><Sparkles size={18} /><strong>{decisionPlanStatus(value)}</strong></div>
    {status}{footer}
    <button type="button" className="commit-plan" disabled={submitDisabled} onClick={onSubmit}><ListChecks size={17} />{submitLabel}</button>
    {history}
  </aside>;
}
