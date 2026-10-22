import { useEffect, useEffectEvent } from "react";
import type { ShortcutAction, ShortcutSettings } from "../lib/keyboardShortcuts";
import { installKeyboardShortcuts, isShortcutEditingTarget } from "../lib/keyboardShortcutRuntime";

export function useKeyboardShortcuts({ settings, enabled = true, contextKey, isAvailable, onAction }: {
  settings?: ShortcutSettings; enabled?: boolean; contextKey: string;
  isAvailable: (action: ShortcutAction) => boolean;
  onAction: (action: ShortcutAction) => boolean | void;
}) {
  const available = useEffectEvent(isAvailable);
  const dispatch = useEffectEvent(onAction);
  useEffect(() => {
    if (!enabled || !settings?.enabled) return;
    return installKeyboardShortcuts({ target: window, visibilityTarget: document, settings,
      isAvailable: action => available(action), onAction: action => dispatch(action),
      isBlocked: () => document.visibilityState !== "visible" || isShortcutEditingTarget(document.activeElement)
        || Boolean(document.querySelector('[role="dialog"], [aria-modal="true"], [data-shortcut-blocked="true"]')),
    });
  }, [settings, enabled, contextKey]);
}
