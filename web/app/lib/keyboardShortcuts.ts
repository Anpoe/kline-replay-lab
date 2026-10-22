export const shortcutActions = [
  { id: "chartLeft", group: "看盘", label: "图表向历史平移", key: "KeyA", repeat: true, help: "只移动图表视野，不改变回放进度或交易。" },
  { id: "chartRight", group: "看盘", label: "图表向最新平移", key: "KeyD", repeat: true, help: "只移动图表视野，不揭示未来 K 线。" },
  { id: "chartZoomIn", group: "看盘", label: "放大图表", key: "Equal", repeat: true, help: "放大 K 线间距。" },
  { id: "chartZoomOut", group: "看盘", label: "缩小图表", key: "Minus", repeat: true, help: "缩小 K 线间距。" },
  { id: "chartLatest", group: "看盘", label: "回到最新可见 K 线", key: "End", repeat: false, help: "定位到当前已揭示或已收到的最后一根 K 线。" },
  { id: "timeframePrevious", group: "看盘", label: "上一个时间周期", key: "BracketLeft", repeat: false, help: "在当前可用周期内切换。" },
  { id: "timeframeNext", group: "看盘", label: "下一个时间周期", key: "BracketRight", repeat: false, help: "在当前可用周期内切换。" },
  { id: "indicators", group: "看盘", label: "图表指标设置", key: "KeyI", repeat: false, help: "打开或收起图表指标设置。" },
  { id: "replayPrevious", group: "回放", label: "上一根 K 线", key: "ArrowLeft", repeat: true, help: "暂停播放后回退一根；沿用现有回退范围，不撤销已发生的交易。随机训练不可回退。" },
  { id: "replayNext", group: "回放", label: "下一根 K 线", key: "ArrowRight", repeat: true, help: "暂停播放后推进一根；已有委托按现有训练规则执行。" },
  { id: "replayForwardFive", group: "回放", label: "前进五根 K 线", key: "Shift+ArrowRight", repeat: true, help: "每次推进五根，仍遵循交易时段、委托及训练结束边界。" },
  { id: "replayPlay", group: "回放", label: "播放 / 暂停", key: "Space", repeat: false, help: "切换训练自动播放状态；长按只切换一次。" },
  { id: "tradeBuy", group: "交易", label: "买入开仓", key: "Alt+KeyB", repeat: false, help: "按当前下单参数操作，沿用市场限制、交易权限及现有检查。" },
  { id: "tradeSell", group: "交易", label: "卖出开仓", key: "Alt+KeyS", repeat: false, help: "按当前下单参数操作；禁止做空的市场不可使用。" },
  { id: "tradeCloseAll", group: "交易", label: "全部平仓", key: "Alt+KeyX", repeat: false, help: "沿用当前页面的全部平仓范围和确认流程；MT4 包含当前账户全部品种持仓。" },
  { id: "tradeStopLoss", group: "交易", label: "图表选择止损", key: "Alt+KeyL", repeat: false, help: "切换图表止损取价，不直接修改已提交订单。" },
  { id: "tradeTakeProfit", group: "交易", label: "图表选择止盈", key: "Alt+KeyT", repeat: false, help: "切换图表止盈取价，不直接修改已提交订单。" },
  { id: "drawingTrend", group: "绘图", label: "趋势线", key: "KeyT", repeat: false, help: "选择趋势线绘图工具。" },
  { id: "drawingPosition", group: "绘图", label: "仓位规划工具", key: "KeyP", repeat: false, help: "选择仓位规划工具，不会提交交易。" },
  { id: "drawingCursor", group: "绘图", label: "切换光标", key: "KeyV", repeat: false, help: "退出绘图或取价，切换回图表光标。" },
  { id: "drawingUndo", group: "绘图", label: "撤销绘图", key: "Ctrl+KeyZ", repeat: false, help: "撤销最近一次绘图修改，不撤销交易。" },
  { id: "drawingRedo", group: "绘图", label: "重做绘图", key: "Ctrl+Shift+KeyZ", repeat: false, help: "重做已撤销的绘图修改。" },
  { id: "saveTraining", group: "常用操作", label: "保存训练", key: "Ctrl+KeyS", repeat: false, help: "保存当前训练；仅在训练页面生效。" },
  { id: "randomTraining", group: "常用操作", label: "开始随机训练", key: "Alt+KeyN", repeat: false, help: "使用当前随机训练选项开始一局训练。" },
  { id: "openSettings", group: "常用操作", label: "打开设置", key: "Alt+Comma", repeat: false, help: "打开设置；设置或其他弹窗打开时暂停快捷键。" },
] as const;

export type ShortcutAction = typeof shortcutActions[number]["id"];
export type ShortcutSettings = { enabled: boolean; repeatIntervalMs: number; bindings: Record<ShortcutAction, string | null> };
export const defaultShortcutSettings: ShortcutSettings = {
  enabled: true,
  repeatIntervalMs: 100,
  bindings: Object.fromEntries(shortcutActions.map(action => [action.id, action.key])) as ShortcutSettings["bindings"],
};

const modifiers = ["Ctrl", "Alt", "Shift", "Meta"] as const;
const keyPattern = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|NumpadAdd|NumpadSubtract|NumpadMultiply|NumpadDivide|NumpadDecimal|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown|Insert|Delete|Backspace|Escape|Tab|Enter|Space|Comma|Period|Slash|Backslash|Semicolon|Quote|Backquote|Equal|Minus|BracketLeft|BracketRight|F([1-9]|1[0-2]))$/;

export function canonicalShortcut(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parts = value.split("+");
  const code = parts.pop();
  if (!code || !keyPattern.test(code) || new Set(parts).size !== parts.length || parts.some(part => !modifiers.includes(part as typeof modifiers[number]))) return null;
  return [...modifiers.filter(modifier => parts.includes(modifier)), code].join("+");
}

export function shortcutFromEvent(event: { code: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean; isComposing?: boolean; getModifierState?: (key: string) => boolean }): string | null {
  if (event.isComposing || event.getModifierState?.("AltGraph")) return null;
  return canonicalShortcut([event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Meta", event.code].filter(Boolean).join("+"));
}

export function isReservedShortcut(binding: string) {
  const parts = binding.split("+"), code = parts.at(-1)!;
  if (["Escape", "Tab", "Enter", "Delete", "Backspace", "F1", "F3", "F5", "F6", "F7", "F11", "F12"].includes(code)) return true;
  if (parts.includes("Alt") && ["F4", "ArrowLeft", "ArrowRight", "Home", "Space"].includes(code)) return true;
  if ((parts.includes("Ctrl") || parts.includes("Meta")) && ["KeyW", "KeyT", "KeyN", "KeyR", "KeyL", "KeyO", "KeyP", "KeyF", "KeyH", "KeyJ", "KeyU", "KeyD", "Space"].includes(code)) return true;
  return parts.includes("Meta") && ["KeyQ", "KeyM"].includes(code);
}

export function formatShortcut(value: string | null) {
  if (!value) return "未设置";
  const labels: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Space: "空格", Equal: "=", Minus: "−", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", BracketLeft: "[", BracketRight: "]", Backquote: "`", Semicolon: ";", Quote: "'", Meta: "Win / ⌘" };
  return value.split("+").map(part => labels[part] ?? part.replace(/^Key|^Digit/, "")).join(" + ");
}

export function validateShortcutSettings(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return "快捷键设置无效，请恢复默认后重试。";
  const settings = value as Partial<ShortcutSettings>;
  if (settings.repeatIntervalMs != null && (!Number.isInteger(settings.repeatIntervalMs) || settings.repeatIntervalMs < 50 || settings.repeatIntervalMs > 500)) return "长按间隔需要填写 50–500 的整数毫秒数。";
  if (settings.enabled != null && typeof settings.enabled !== "boolean") return "快捷键开关无效，请恢复默认后重试。";
  if (settings.bindings != null && (typeof settings.bindings !== "object" || Array.isArray(settings.bindings))) return "快捷键设置无效，请恢复默认后重试。";
  const seen = new Map<string, string>();
  for (const action of shortcutActions) {
    const value = settings.bindings?.[action.id];
    if (value === null) continue;
    const binding = value === undefined ? action.key : canonicalShortcut(value);
    if (!binding) return `${action.label}的快捷键无效，请重新录入。`;
    if (isReservedShortcut(binding)) return `${formatShortcut(binding)} 是浏览器或系统保留按键，请选择其他组合。`;
    const previous = seen.get(binding);
    if (previous) return `快捷键冲突：${formatShortcut(binding)} 同时用于“${previous}”和“${action.label}”。请先清除其中一个。`;
    seen.set(binding, action.label);
  }
  return null;
}

export function normalizeShortcutSettings(value: unknown): ShortcutSettings {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<ShortcutSettings> : {};
  const bindings = Object.fromEntries(shortcutActions.map(action => {
    const stored = raw.bindings?.[action.id];
    const binding = stored === undefined ? action.key : canonicalShortcut(stored);
    return [action.id, binding && !isReservedShortcut(binding) ? binding : null];
  })) as ShortcutSettings["bindings"];
  const counts = new Map<string, number>();
  for (const binding of Object.values(bindings)) if (binding) counts.set(binding, (counts.get(binding) ?? 0) + 1);
  for (const action of shortcutActions) if (bindings[action.id] && counts.get(bindings[action.id]!)! > 1) bindings[action.id] = null;
  return {
    enabled: raw.enabled !== false,
    repeatIntervalMs: Number.isInteger(raw.repeatIntervalMs) && raw.repeatIntervalMs! >= 50 && raw.repeatIntervalMs! <= 500 ? raw.repeatIntervalMs! : 100,
    bindings,
  };
}

export function filterShortcutActions(query: string) {
  const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  const text = normalize(query);
  if (!text || /^(快捷键|快捷键设置|按键|键位|热键|keyboard|shortcut)$/.test(text)) return [...shortcutActions];
  const terms = query.trim().split(/\s+/).map(normalize);
  return shortcutActions.filter(action => terms.every(term => normalize(`${action.group}${action.label}${action.help} ${formatShortcut(action.key)} ${action.repeat ? "长按 连续 快进 快退" : ""}`).includes(term)));
}
