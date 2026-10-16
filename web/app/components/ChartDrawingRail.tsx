"use client";
import { ChevronRight, List, Magnet, MousePointer2, Redo2, Trash2, Undo2 } from "lucide-react";
import { drawingToolGroups, type DrawingTool } from "./chartDrawingTools";
export function ChartDrawingRail({ className = "drawing-rail", observing, cursorActive, onCursor, activeTool, groupTools, openGroup, onOpenGroup,
  onSelectTool, onGroupTool, magnetMode, onMagnetMode, canUndo, canRedo, onUndo, onRedo, objectsOpen, onObjects, onClear, disabled }: {
  className?: string; observing?: boolean; cursorActive: boolean; onCursor: () => void; activeTool?: string; groupTools: Record<string, string>;
  openGroup: string; onOpenGroup: (value: string) => void; onSelectTool: (tool: DrawingTool) => void; onGroupTool: (group: string, tool: string) => void;
  magnetMode: "normal" | "weak_magnet" | "strong_magnet"; onMagnetMode: (value: "normal" | "weak_magnet" | "strong_magnet") => void;
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; objectsOpen: boolean; onObjects: () => void; onClear: () => void; disabled?: boolean;
}) {
  const groupIndex = drawingToolGroups.findIndex(g => g.id === openGroup), expanded = drawingToolGroups[groupIndex];
  return <><div className={`${className}${observing ? " observation-only" : ""}`} aria-label="画图工具" data-shared-drawing-tools>
    <button type="button" className={cursorActive ? "active" : ""} aria-label="光标" title="光标" onClick={onCursor}><MousePointer2 size={18} /></button>
    {drawingToolGroups.map(group => {
      const tool = group.tools.find(t => t.name === groupTools[group.id]) ?? group.tools[0], Icon = tool.icon;
      const button = <button type="button" disabled={disabled} className={openGroup === group.id || activeTool === tool.name ? "active" : ""} title={tool.label} aria-label={tool.label} onClick={() => onSelectTool(tool)}><Icon size={18} /></button>;
      return group.tools.length === 1 ? <span className="drawing-tool-single" key={group.id}>{button}</span>
        : <div className="drawing-tool-group" key={group.id}>{button}<button type="button" className="drawing-group-trigger" disabled={disabled} aria-label={`展开${group.label}`} title={`展开${group.label}`} onClick={() => onOpenGroup(openGroup === group.id ? "" : group.id)}><ChevronRight size={9} /></button></div>;
    })}
    <span className="tool-divider" />
    <button type="button" aria-label="切换磁吸 OHLC" title={magnetMode === "normal" ? "磁吸 OHLC：关闭；开启后对齐附近 K 线开高低收" : magnetMode === "weak_magnet" ? "磁吸 OHLC：弱吸附" : "磁吸 OHLC：强吸附"} className={magnetMode !== "normal" ? "active" : ""} onClick={() => onMagnetMode(magnetMode === "normal" ? "weak_magnet" : magnetMode === "weak_magnet" ? "strong_magnet" : "normal")}><Magnet size={18} /><small>{magnetMode === "weak_magnet" ? "弱" : magnetMode === "strong_magnet" ? "强" : ""}</small></button>
    <button type="button" aria-label="撤销绘图" title="撤销上一笔绘图" disabled={!canUndo} onClick={onUndo}><Undo2 size={18} /></button>
    <button type="button" aria-label="重做绘图" title="重做已撤销的绘图" disabled={!canRedo} onClick={onRedo}><Redo2 size={18} /></button>
    <button type="button" aria-label="绘图对象列表" title="对象树" className={objectsOpen ? "active" : ""} onClick={onObjects}><List size={18} /></button>
    <button type="button" aria-label="清除绘图" title="清除绘图" onClick={onClear}><Trash2 size={18} /></button>
  </div>{expanded && <div className="drawing-tool-flyout" style={{ top: `${42 + groupIndex * 35}px` }}><strong>{expanded.label}</strong>{expanded.tools.map(tool => {
    const Icon = tool.icon; return <button type="button" key={tool.name} onClick={() => { onGroupTool(expanded.id, tool.name); onSelectTool(tool); }}><Icon size={17} /><span>{tool.label}</span></button>;
  })}</div>}</>;
}
