import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultShortcutSettings, normalizeShortcutSettings, shortcutFromEvent,
  formatShortcut, validateShortcutSettings,
} from "../app/lib/keyboardShortcuts.ts";
import { installKeyboardShortcuts } from "../app/lib/keyboardShortcutRuntime.ts";
import { defaultAppSettings, normalizeSettings } from "../app/features/settings/settingsContracts.ts";
import { persistSettingsSave } from "../app/features/settings/settingsController.ts";

function fixture(overrides = {}) {
  const host = new EventTarget(), calls = [], tasks = new Map();
  let clock = 0, nextId = 0, available = true, blocked = false;
  const settings = normalizeShortcutSettings(overrides);
  const dispose = installKeyboardShortcuts({ target: host, settings,
    onAction: action => { calls.push(action); return true; },
    isAvailable: () => available, isBlocked: () => blocked,
    setTimer: (fn, delay) => { const id = ++nextId; tasks.set(id, { at: clock + delay, fn }); return id; },
    clearTimer: id => tasks.delete(id),
  });
  const emit = (type, code, extras = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { code, key: code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, isComposing: false, ...extras });
    host.dispatchEvent(event); return event;
  };
  const tick = duration => {
    const end = clock + duration;
    while (true) {
      const next = [...tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      clock = next[1].at; tasks.delete(next[0]); next[1].fn();
    }
    clock = end;
  };
  return { emit, tick, calls, tasks, dispose, dispatch: event => host.dispatchEvent(event), available: value => { available = value; }, blocked: value => { blocked = value; } };
}

test("old settings gain shortcuts; custom bindings and explicit disabled bindings survive save/reload", async () => {
  const legacy = normalizeSettings({});
  assert.deepEqual(legacy.shortcuts, defaultShortcutSettings);
  const shortcuts = normalizeShortcutSettings({ bindings: { replayNext: "KeyN", tradeBuy: null }, repeatIntervalMs: 150 });
  let saved;
  assert.equal((await persistSettingsSave({ ...defaultAppSettings, shortcuts }, { write: value => { saved = JSON.parse(JSON.stringify(value)); } })).ok, true);
  assert.equal(normalizeSettings(saved).shortcuts.bindings.replayNext, "KeyN");
  assert.equal(normalizeSettings(saved).shortcuts.bindings.tradeBuy, null);
  assert.equal(normalizeSettings(saved).shortcuts.repeatIntervalMs, 150);
});

test("key capture uses physical keys, exact modifiers and readable labels", () => {
  assert.equal(shortcutFromEvent({ code: "KeyB", altKey: true }), "Alt+KeyB");
  assert.equal(shortcutFromEvent({ code: "KeyZ", ctrlKey: true, shiftKey: true }), "Ctrl+Shift+KeyZ");
  assert.equal(shortcutFromEvent({ code: "ShiftLeft", shiftKey: true }), null);
  assert.equal(shortcutFromEvent({ code: "KeyB", isComposing: true }), null);
  assert.equal(formatShortcut("Ctrl+Shift+KeyZ"), "Ctrl + Shift + Z");
  assert.equal(formatShortcut("ArrowRight"), "→");
  assert.equal(formatShortcut(null), "未设置");
});

test("conflicting or browser-reserved keys stop persistence, while clearing and swapping is allowed", async () => {
  let writes = 0;
  const shortcuts = structuredClone(defaultShortcutSettings);
  shortcuts.bindings.tradeSell = shortcuts.bindings.tradeBuy;
  const result = await persistSettingsSave({ ...defaultAppSettings, shortcuts }, { write: () => { writes++; } });
  assert.equal(result.ok, false); assert.match(result.error, /冲突|重复|同时/); assert.equal(writes, 0);
  shortcuts.bindings.tradeSell = null;
  assert.equal(validateShortcutSettings(shortcuts), null);
  shortcuts.bindings.tradeBuy = "Ctrl+KeyW";
  assert.match(validateShortcutSettings(shortcuts), /保留|浏览器|系统/);
  shortcuts.bindings.tradeBuy = "Ctrl+KeyS";
  assert.match(validateShortcutSettings(shortcuts), /冲突|重复|同时/);
});

test("malformed and duplicated stored shortcuts fail closed without disabling unrelated controls", () => {
  const settings = normalizeShortcutSettings({ bindings: { replayNext: "Alt+KeyJ", replayPrevious: "Alt+KeyJ", tradeBuy: "Ctrl+KeyW", chartLatest: "not-a-key" }, repeatIntervalMs: -1 });
  assert.equal(settings.bindings.replayNext, null); assert.equal(settings.bindings.replayPrevious, null);
  assert.equal(settings.bindings.tradeBuy, null); assert.equal(settings.bindings.chartLatest, null);
  assert.equal(settings.bindings.replayPlay, "Space");
  assert.equal(settings.repeatIntervalMs, defaultShortcutSettings.repeatIntervalMs);
});

test("press once steps once; hold repeats after a delay and keyup stops every scheduled step", () => {
  const f = fixture();
  assert.equal(f.emit("keydown", "ArrowRight").defaultPrevented, true);
  assert.deepEqual(f.calls, ["replayNext"]);
  f.tick(349); assert.equal(f.calls.length, 1);
  f.tick(1); assert.equal(f.calls.length, 2);
  f.tick(300); assert.equal(f.calls.length, 5);
  f.emit("keyup", "ArrowRight"); f.tick(1000);
  assert.equal(f.calls.length, 5); assert.equal(f.tasks.size, 0); f.dispose();
});

test("trading, save and play never auto-repeat, including repeated non-repeat keydown events", () => {
  for (const [code, modifiers, action] of [["KeyB", { altKey: true }, "tradeBuy"], ["KeyS", { ctrlKey: true }, "saveTraining"], ["Space", {}, "replayPlay"]]) {
    const f = fixture();
    f.emit("keydown", code, modifiers); f.emit("keydown", code, modifiers); f.emit("keydown", code, { ...modifiers, repeat: true }); f.tick(3000);
    assert.deepEqual(f.calls, [action]);
    f.emit("keyup", code); f.emit("keydown", code, modifiers);
    assert.deepEqual(f.calls, [action, action]); f.dispose();
  }
});

test("blur, hidden page, pagehide, modifier release and disposal cancel a held shortcut", () => {
  for (const reason of ["blur", "visibilitychange", "pagehide", "modifier", "dispose"]) {
    const f = fixture(); f.emit("keydown", "ArrowRight", { shiftKey: true }); f.tick(350);
    const count = f.calls.length;
    if (reason === "modifier") f.emit("keyup", "ShiftLeft");
    else if (reason === "dispose") f.dispose();
    else f.emit(reason);
    f.tick(1000); assert.equal(f.calls.length, count, reason); f.dispose();
  }
});

test("availability boundaries, dialogs and focused edits stop long presses and do not resume on native repeats", () => {
  for (const stop of ["available", "blocked"]) {
    const f = fixture(); f.emit("keydown", "ArrowRight"); f.tick(350); const count = f.calls.length;
    f[stop](stop === "blocked"); f.tick(100);
    f[stop](stop !== "blocked"); f.emit("keydown", "ArrowRight", { repeat: true }); f.tick(500);
    assert.equal(f.calls.length, count); f.emit("keyup", "ArrowRight"); f.emit("keydown", "ArrowRight");
    assert.equal(f.calls.length, count + 1); f.dispose();
  }
});

test("disabled shortcuts, composition, prevented events and unrelated modifiers do not execute", () => {
  const disabled = fixture({ enabled: false }); disabled.emit("keydown", "ArrowRight"); assert.equal(disabled.calls.length, 0); disabled.dispose();
  const f = fixture();
  f.emit("keydown", "ArrowRight", { isComposing: true });
  f.emit("keydown", "ArrowRight", { ctrlKey: true });
  f.emit("keydown", "ArrowRight", { repeat: true });
  const event = new Event("keydown", { cancelable: true }); Object.assign(event, { code: "ArrowRight" }); event.preventDefault();
  f.dispatch(event);
  // The matching press is still usable after ignored input.
  assert.equal(f.calls.length, 0); f.emit("keydown", "ArrowRight"); assert.equal(f.calls.length, 1); f.dispose();
});

test("pressing a new modifier ends an existing hold instead of repeating the previous combination", () => {
  const f = fixture(); f.emit("keydown", "ArrowRight"); f.tick(350);
  f.emit("keydown", "ControlLeft", { ctrlKey: true });
  const count = f.calls.length; f.tick(500);
  assert.equal(f.calls.length, count); assert.equal(f.tasks.size, 0); f.dispose();
});

test("starting a different held action leaves exactly one repeat loop", () => {
  const f = fixture(); f.emit("keydown", "ArrowRight"); f.tick(100);
  f.emit("keydown", "ArrowLeft"); f.tick(350);
  assert.deepEqual(f.calls, ["replayNext", "replayPrevious", "replayPrevious"]);
  assert.equal(f.tasks.size, 1); f.dispose(); assert.equal(f.tasks.size, 0);
});

test("chart and replay scopes cannot keep independent hold loops running together", () => {
  const target = new EventTarget(), tasks = new Map(), calls = [];
  let id = 0;
  const options = { target, settings: defaultShortcutSettings, setTimer: fn => { const next = ++id; tasks.set(next, fn); return next; }, clearTimer: token => tasks.delete(token), onAction: action => { calls.push(action); } };
  const chart = installKeyboardShortcuts({ ...options, isAvailable: action => action.startsWith("chart") });
  const replay = installKeyboardShortcuts({ ...options, isAvailable: action => action.startsWith("replay") });
  for (const code of ["KeyA", "ArrowRight"]) {
    const event = new Event("keydown", { cancelable: true }); Object.assign(event, { code, repeat: false }); target.dispatchEvent(event);
  }
  assert.deepEqual(calls, ["chartLeft", "replayNext"]); assert.equal(tasks.size, 1);
  chart(); replay(); assert.equal(tasks.size, 0);
});
