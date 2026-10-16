"use client";
import { Eye, EyeOff, Lock, Trash2, Unlock, X } from "lucide-react";
import type { PersistedDrawing } from "./KLineReplayChart";
import { drawingLabel } from "./chartDrawingTools";
export function DrawingObjectPanel({ drawings, selectedId, onSelect, onUpdate, onDelete, onClose }: {
  drawings: readonly PersistedDrawing[]; selectedId: string; onSelect: (id: string) => void; onUpdate: (id: string, changes: Partial<PersistedDrawing>) => void; onDelete: (id: string) => void; onClose: () => void;
}) {
  return <aside className="drawing-object-panel" aria-label="绘图对象列表"><header><strong>对象树</strong><button type="button" aria-label="关闭对象树" onClick={onClose}><X size={15} /></button></header>
    <div className="drawing-object-list">{drawings.length ? [...drawings].reverse().map((drawing, index) => <div className={drawing.id === selectedId ? "active" : ""} key={drawing.id}>
      <button type="button" className="drawing-object-name" onClick={() => onSelect(drawing.id)}><span>{drawingLabel(drawing.name)}</span><small>#{drawings.length - index}</small></button>
      <button type="button" aria-label={drawing.visible ? "隐藏对象" : "显示对象"} onClick={() => onUpdate(drawing.id, { visible: !drawing.visible })}>{drawing.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
      <button type="button" aria-label={drawing.lock ? "解锁对象" : "锁定对象"} onClick={() => onUpdate(drawing.id, { lock: !drawing.lock })}>{drawing.lock ? <Lock size={14} /> : <Unlock size={14} />}</button>
      <button type="button" className="danger" aria-label="删除对象" onClick={() => onDelete(drawing.id)}><Trash2 size={14} /></button>
    </div>) : <p>还没有绘图对象。</p>}</div>
  </aside>;
}
