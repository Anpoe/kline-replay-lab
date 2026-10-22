import { shortcutActions, shortcutFromEvent, type ShortcutAction, type ShortcutSettings } from "./keyboardShortcuts.ts";

type TimerToken = ReturnType<typeof setTimeout> | number;
export function isShortcutEditingTarget(target: EventTarget | null) {
  return Boolean((target as Element | null)?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [data-shortcut-capture]'));
}

export function installKeyboardShortcuts({ target, visibilityTarget = target, settings, onAction, isAvailable, isBlocked = () => false, setTimer = setTimeout, clearTimer = clearTimeout }: {
  target: EventTarget;
  visibilityTarget?: EventTarget;
  settings: ShortcutSettings;
  onAction: (action: ShortcutAction) => boolean | void;
  isAvailable: (action: ShortcutAction) => boolean;
  isBlocked?: () => boolean;
  setTimer?: (fn: () => void, delay: number) => TimerToken;
  clearTimer?: (token: TimerToken) => void;
}) {
  let timer: TimerToken | null = null;
  let active: { action: ShortcutAction; code: string } | null = null;
  const pressed = new Set<string>();
  const cancel = () => { if (timer !== null) clearTimer(timer); timer = null; active = null; pressed.clear(); };
  const repeat = () => {
    timer = null;
    if (!active || isBlocked() || !isAvailable(active.action)) { cancel(); return; }
    if (onAction(active.action) === false) { cancel(); return; }
    if (active) timer = setTimer(repeat, settings.repeatIntervalMs);
  };
  const down = (raw: Event) => {
    const event = raw as KeyboardEvent;
    if (!settings.enabled || event.defaultPrevented || event.isComposing || isBlocked() || isShortcutEditingTarget(event.target)) { cancel(); return; }
    // All scopes see the new press, including the scope that owned the prior hold.
    if (active && event.code !== active.code && !event.repeat) cancel();
    const element = event.target as Element | null;
    if (event.code === "Space" && element?.closest?.('button, a[href], summary, [role="button"]')) return;
    if (["Space", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.code)
      && element?.closest?.('[role="slider"], [role="menu"], [role="listbox"]')) return;
    const binding = shortcutFromEvent(event);
    const action = shortcutActions.find(action => settings.bindings[action.id] === binding);
    if (!binding || !action || !isAvailable(action.id)) return;
    event.preventDefault();
    if (event.repeat || pressed.has(event.code)) return;
    // A new action ends any preceding navigation hold. One press never starts two loops.
    if (timer !== null) clearTimer(timer);
    timer = null; active = null; pressed.add(event.code);
    if (onAction(action.id) === false) return;
    if (action.repeat) { active = { action: action.id, code: event.code }; timer = setTimer(repeat, 350); }
  };
  const up = (raw: Event) => {
    const event = raw as KeyboardEvent;
    pressed.delete(event.code);
    if (active && (active.code === event.code || /^(Control|Alt|Shift|Meta)(Left|Right)$/.test(event.code))) cancel();
  };
  target.addEventListener("keydown", down);
  target.addEventListener("keyup", up);
  target.addEventListener("blur", cancel);
  target.addEventListener("pagehide", cancel);
  visibilityTarget.addEventListener("visibilitychange", cancel);
  return () => {
    cancel(); target.removeEventListener("keydown", down); target.removeEventListener("keyup", up);
    target.removeEventListener("blur", cancel); target.removeEventListener("pagehide", cancel);
    visibilityTarget.removeEventListener("visibilitychange", cancel);
  };
}
