"use client";
import { Eye, EyeOff, Lock, Trash2, Unlock, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { PersistedDrawing } from "./KLineReplayChart";
import { drawingLabel } from "./chartDrawingTools";
const rectangleColors = [
  ["绿色", "--accent"], ["红色", "--danger"], ["黄色", "--warning"],
  ["蓝色", "--drawing-blue"], ["紫色", "--drawing-purple"], ["白色", "--foreground"],
];
export function DrawingPropertyBar({ drawing, text, color, lineWidth, textSize, onText, onColor, onWidth, onTextSize, onLock, onVisible, onDelete, onClose }: {
  drawing: PersistedDrawing; text: string; color: string; lineWidth: number; textSize: number;
  onText: (value: string) => void; onColor: (value: string) => void; onWidth: (value: number) => void; onTextSize: (value: number) => void;
  onLock: () => void; onVisible: () => void; onDelete: () => void; onClose: () => void;
}) {
  const [sizeDraft, setSizeDraft] = useState<{ id: string; value: string } | null>(null);
  const sizeHintId = useId();
  const paletteId = useId();
  const colorButton = useRef<HTMLButtonElement>(null);
  const [palettePosition, setPalettePosition] = useState({ left: 0, top: 0 });
  const commitSize = (value: number) => {
    if (Number.isFinite(value) && value >= 10 && value <= 96) onTextSize(Math.round(value * 10) / 10);
  };
  const isText = drawing.name === "trainingTextBox";
  const isRectangle = drawing.name === "trainingRectangle";
  return <div className={`drawing-property-bar ${isText ? "text-box-properties" : ""}`} aria-label="绘图属性"><span className="drawing-selected-name">{drawingLabel(drawing.name)}</span>
    {isText && <input className="drawing-text-content" value={text} aria-label="文字内容" title="文字内容" onChange={e => onText(e.target.value)} />}
    {isRectangle ? <>
      <button ref={colorButton} type="button" className="drawing-color-trigger" popoverTarget={paletteId} aria-label="矩形颜色" title="矩形颜色" onClick={() => {
        const bounds = colorButton.current?.getBoundingClientRect();
        if (bounds) setPalettePosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - 224)), top: bounds.bottom + 90 < window.innerHeight ? bounds.bottom + 6 : bounds.top - 90 });
      }}><span style={{ backgroundColor: color }} /></button>
      <div id={paletteId} popover="auto" className="drawing-color-palette" style={palettePosition} aria-label="矩形预设颜色">
        <div className="drawing-color-presets">{rectangleColors.map(([label, token]) => <button key={token} type="button" aria-label={`矩形颜色：${label}`} title={label} style={{ backgroundColor: `var(${token})` }} onClick={event => {
          onColor(getComputedStyle(document.documentElement).getPropertyValue(token).trim());
          event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
        }} />)}</div>
        <label className="drawing-custom-color">自定义<input type="color" value={color} aria-label="自定义矩形颜色" onChange={event => onColor(event.target.value)} /></label>
      </div>
    </> : <label className="drawing-color-control" title={isText ? "文字颜色" : "线条颜色"}><input type="color" value={color} aria-label={isText ? "文字颜色" : "线条颜色"} onChange={e => onColor(e.target.value)} /></label>}
    <select value={lineWidth} aria-label={isRectangle ? "矩形边框" : "线条粗细"} title={isRectangle ? "矩形边框" : "线条粗细"} onChange={e => onWidth(Number(e.target.value))}>{isRectangle && <option value={0}>无边框</option>}{[1, 2, 3, 4].map(size => <option key={size} value={size}>{size}px</option>)}</select>
    {isText && <div className="drawing-text-size-control" title="文字大小：10–96px；可拖动调节或输入数值，精确到 0.1px">
      <input type="range" min={10} max={96} step={0.1} value={textSize} aria-label="连续调节文字大小" aria-describedby={sizeHintId} aria-valuetext={`${Number(textSize.toFixed(1))}px`} onChange={e => commitSize(e.target.valueAsNumber)} />
      <input type="number" min={10} max={96} step={0.1} value={sizeDraft?.id === drawing.id ? sizeDraft.value : Number(textSize.toFixed(1))} aria-label="文字大小" aria-describedby={sizeHintId} onChange={e => { setSizeDraft({ id: drawing.id, value: e.target.value }); commitSize(e.target.valueAsNumber); }} onBlur={e => { if (e.target.value !== "" && Number.isFinite(e.target.valueAsNumber)) commitSize(Math.max(10, Math.min(96, e.target.valueAsNumber))); setSizeDraft(null); }} />
      <span id={sizeHintId} className="live-sr-only">10–96px，可输入数值或用方向键按 0.1px 微调</span>
      <span aria-hidden="true">px</span>
    </div>}
    <button type="button" title={drawing.lock ? "解锁绘图" : "锁定绘图"} aria-label={drawing.lock ? "解锁绘图" : "锁定绘图"} onClick={onLock}>{drawing.lock ? <Unlock size={16} /> : <Lock size={16} />}</button>
    <button type="button" title={drawing.visible ? "隐藏绘图" : "显示绘图"} aria-label={drawing.visible ? "隐藏绘图" : "显示绘图"} onClick={onVisible}>{drawing.visible ? <Eye size={16} /> : <EyeOff size={16} />}</button>
    <button type="button" className="danger" title="删除绘图" aria-label="删除当前绘图" onClick={onDelete}><Trash2 size={16} /></button><button type="button" title="关闭属性栏" aria-label="关闭绘图属性" onClick={onClose}><X size={15} /></button>
  </div>;
}
