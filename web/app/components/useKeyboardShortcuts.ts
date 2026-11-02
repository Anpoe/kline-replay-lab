import { useEffect, useEffectEvent, type RefObject } from "react";
import type { ShortcutAction, ShortcutSettings } from "../lib/keyboardShortcuts";
import { installKeyboardShortcuts, isShortcutEditingTarget } from "../lib/keyboardShortcutRuntime";
import { installPointerRepeat } from "../lib/pressRepeat";

function isInteractionBlocked(checkEditing = true) {
  return document.visibilityState !== "visible" || (checkEditing && isShortcutEditingTarget(document.activeElement))
    || Boolean(document.querySelector('[role="dialog"], [aria-modal="true"], [data-shortcut-blocked="true"]'));
}

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
      isBlocked: () => isInteractionBlocked(),
    });
  }, [settings, enabled, contextKey]);
}

export function usePointerRepeat({ targetRef, enabled, contextKey, repeatIntervalMs, isAvailable, onAction }: {
  targetRef: RefObject<HTMLButtonElement | null>;
  enabled: boolean;
  contextKey: string;
  repeatIntervalMs: number;
  isAvailable: () => boolean;
  onAction: () => boolean | void;
}) {
  const available = useEffectEvent(isAvailable);
  const dispatch = useEffectEvent(onAction);
  useEffect(() => {
    if (!enabled || !targetRef.current) return;
    return installPointerRepeat({ target: targetRef.current, host: window, visibilityTarget: document,
      repeatIntervalMs, isAvailable: () => available(), onAction: () => dispatch(),
      isBlocked: () => isInteractionBlocked(false),
    });
  }, [targetRef, enabled, contextKey, repeatIntervalMs]);
}
