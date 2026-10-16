"use client";
import { Eye, EyeOff, Lock, Trash2, Unlock, X } from "lucide-react";
import type { PersistedDrawing } from "./KLineReplayChart";
import { drawingLabel } from "./chartDrawingTools";
export function DrawingPropertyBar({ drawing, text, color, lineWidth, textSize, textSizeOptions, onText, onColor, onWidth, onTextSize, onLock, onVisible, onDelete, onClose }: {
  drawing: PersistedDrawing; text: string; color: string; lineWidth: number; textSize: number; textSizeOptions: readonly number[];
  onText: (value: string) => void; onColor: (value: string) => void; onWidth: (value: number) => void; onTextSize: (value: number) => void;
  onLock: () => void; onVisible: () => void; onDelete: () => void; onClose: () => void;
}) {
  const isText = drawing.name === "trainingTextBox";
  return <div className={`drawing-property-bar ${isText ? "text-box-properties" : ""}`} aria-label="绘图属性"><span className="drawing-selected-name">{drawingLabel(drawing.name)}</span>
    {isText && <input className="drawing-text-content" value={text} aria-label="文字内容" title="文字内容" onChange={e => onText(e.target.value)} />}
    <label className="drawing-color-control" title={isText ? "文字颜色" : "线条颜色"}><input type="color" value={color} aria-label={isText ? "文字颜色" : "线条颜色"} onChange={e => onColor(e.target.value)} /></label>
    <select value={lineWidth} aria-label="线条粗细" title="线条粗细" onChange={e => onWidth(Number(e.target.value))}>{[1, 2, 3, 4].map(size => <option key={size} value={size}>{size}px</option>)}</select>
    {isText && <select value={textSize} aria-label="文字大小" title="文字大小" onChange={e => onTextSize(Number(e.target.value))}>{textSizeOptions.map(size => <option key={size} value={size}>{size}px</option>)}</select>}
    <button type="button" title={drawing.lock ? "解锁绘图" : "锁定绘图"} aria-label={drawing.lock ? "解锁绘图" : "锁定绘图"} onClick={onLock}>{drawing.lock ? <Unlock size={16} /> : <Lock size={16} />}</button>
    <button type="button" title={drawing.visible ? "隐藏绘图" : "显示绘图"} aria-label={drawing.visible ? "隐藏绘图" : "显示绘图"} onClick={onVisible}>{drawing.visible ? <Eye size={16} /> : <EyeOff size={16} />}</button>
    <button type="button" className="danger" title="删除绘图" aria-label="删除当前绘图" onClick={onDelete}><Trash2 size={16} /></button><button type="button" title="关闭属性栏" aria-label="关闭绘图属性" onClick={onClose}><X size={15} /></button>
  </div>;
}
