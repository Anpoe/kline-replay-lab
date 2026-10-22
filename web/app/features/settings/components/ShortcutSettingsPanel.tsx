import { useState, type KeyboardEvent } from "react";
import { RotateCcw, X } from "lucide-react";
import { SettingsHelp } from "../../../components/SettingsHelp";
import { defaultShortcutSettings, filterShortcutActions, formatShortcut, normalizeShortcutSettings, shortcutFromEvent, validateShortcutSettings, type ShortcutAction, type ShortcutSettings } from "../../../lib/keyboardShortcuts";

export function ShortcutSettingsPanel({ value, query, onChange }: {
  value: ShortcutSettings; query: string; onChange: (next: ShortcutSettings) => void;
}) {
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState<{ action: ShortcutAction; message: string } | null>(null);
  const actions = filterShortcutActions(query);
  const groups = [...new Set(actions.map(action => action.group))];
  const capture = (event: KeyboardEvent<HTMLButtonElement>, action: ShortcutAction) => {
    if (recording !== action) return;
    event.preventDefault(); event.stopPropagation();
    if (event.repeat || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { setRecording(null); setError(null); return; }
    const binding = ["Delete", "Backspace"].includes(event.key) ? null : shortcutFromEvent(event.nativeEvent);
    if (binding === null && !["Delete", "Backspace"].includes(event.key)) return;
    const next = { ...value, bindings: { ...value.bindings, [action]: binding } };
    const message = validateShortcutSettings(next);
    if (message) { setError({ action, message }); return; }
    onChange(next); setRecording(null); setError(null);
  };
  return <section className="settings-rule settings-group settings-shortcuts" aria-labelledby="settings-group-shortcuts" data-settings-group="shortcuts">
    <header className="settings-group-head"><h4 id="settings-group-shortcuts">快捷键</h4><SettingsHelp label="快捷键使用说明">点击键位后按下新组合；Delete 清除，Esc 取消录入。保存后生效。输入文字、编辑表单和打开弹窗时暂停快捷键。标有“长按”的操作会在按住 350 毫秒后连续执行，松手或切走窗口即停止。</SettingsHelp></header>
    <div className="shortcut-options">
      <div className="settings-row-action"><strong>启用快捷键</strong><button type="button" className={`settings-switch${value.enabled ? " on" : ""}`} role="switch" aria-label="启用快捷键" aria-checked={value.enabled} onClick={() => onChange({ ...value, enabled: !value.enabled })}><span /></button></div>
      <label title="长按后每次连续操作之间的间隔；50–500 毫秒。只影响标有长按的操作。">长按间隔（毫秒）<input aria-label="长按间隔（毫秒）" type="number" min="50" max="500" step="10" value={value.repeatIntervalMs} onChange={event => onChange({ ...value, repeatIntervalMs: Number(event.target.value) })} /></label>
      <button type="button" className="ghost-button" title="恢复所有快捷键及长按间隔；保存后生效。" onClick={() => { onChange(normalizeShortcutSettings(defaultShortcutSettings)); setRecording(null); setError(null); }}><RotateCcw size={14} />恢复默认</button>
    </div>
    <p className="settings-consequence">交易按键仅触发一次；MT4 操作会提交至已授权账户，全平覆盖账户全部持仓。回退不撤销交易，随机训练不能回退。</p>
    {groups.map(group => <div className="shortcut-group" key={group}><h5>{group}</h5>
      {actions.filter(action => action.group === group).map(action => <div className="shortcut-row" key={action.id}>
        <span className="shortcut-label" title={action.help}>{action.label}{action.repeat && <span className="shortcut-repeat">长按</span>}</span>
        <button type="button" className={`shortcut-binding${recording === action.id ? " recording" : ""}`} data-shortcut-capture="true" aria-label={`${action.label}快捷键：${recording === action.id ? "正在录入" : formatShortcut(value.bindings[action.id])}`} aria-describedby={`shortcut-help-${action.id}`} onClick={() => { setRecording(action.id); setError(null); }} onKeyDown={event => capture(event, action.id)} onBlur={() => setRecording(null)}><kbd>{recording === action.id ? "请按组合键…" : formatShortcut(value.bindings[action.id])}</kbd></button>
        <button type="button" className="shortcut-clear" aria-label={`清除${action.label}快捷键`} title="清除快捷键" disabled={!value.bindings[action.id]} onClick={() => { onChange({ ...value, bindings: { ...value.bindings, [action.id]: null } }); setError(null); }}><X size={13} /></button>
        <span id={`shortcut-help-${action.id}`} className="live-sr-only">{action.help} 点击后录入组合键，Delete 清除，Esc 取消；保存后生效。</span>
        {error?.action === action.id && <p className="shortcut-error" role="alert">{error.message}</p>}
      </div>)}
    </div>)}
    {!actions.length && <p className="settings-consequence">没有找到对应操作，可清除搜索查看全部快捷键。</p>}
  </section>;
}
