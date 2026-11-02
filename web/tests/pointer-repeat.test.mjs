import assert from "node:assert/strict";
import test from "node:test";
import { installPointerRepeat } from "../app/lib/pressRepeat.ts";

function fixture() {
  const button = new EventTarget(), host = new EventTarget(), visibility = new EventTarget();
  const tasks = new Map(), calls = [];
  let now = 0, id = 0, available = true, blocked = false, accepted = true;
  button.getBoundingClientRect = () => ({ left: 0, right: 44, top: 0, bottom: 44 });
  const dispose = installPointerRepeat({ target: button, host, visibilityTarget: visibility,
    repeatIntervalMs: 100, isAvailable: () => available, isBlocked: () => blocked,
    onAction: () => { calls.push(now); return accepted; },
    setTimer: (fn, delay) => { const token = ++id; tasks.set(token, { at: now + delay, fn }); return token; },
    clearTimer: token => tasks.delete(token),
  });
  const emit = (type, extras = {}, target = button) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerType: "touch", pointerId: 1, isPrimary: true, button: 0, clientX: 22, clientY: 22, detail: 1, ...extras });
    target.dispatchEvent(event); return event;
  };
  const tick = duration => {
    const end = now + duration;
    while (true) {
      const task = [...tasks].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!task) break;
      now = task[1].at; tasks.delete(task[0]); task[1].fn();
    }
    now = end;
  };
  return { button, host, visibility, emit, tick, calls, tasks, dispose,
    available: value => { available = value; }, blocked: value => { blocked = value; }, accepted: value => { accepted = value; } };
}

test("a touch tap advances once and consumes its trailing click; keyboard activation remains available", () => {
  const f = fixture();
  f.emit("pointerdown"); f.tick(100); f.emit("pointerup"); f.tick(500);
  assert.deepEqual(f.calls, [0]);
  assert.equal(f.emit("click").defaultPrevented, true);
  assert.equal(f.emit("click", { detail: 0 }).defaultPrevented, false);
  f.dispose();
});

test("touch hold shares keyboard delay and interval, then stops immediately on release", () => {
  const f = fixture(); f.emit("pointerdown");
  f.tick(349); assert.deepEqual(f.calls, [0]);
  f.tick(301); assert.deepEqual(f.calls, [0, 350, 450, 550, 650]);
  f.emit("pointerup"); f.tick(1000);
  assert.equal(f.calls.length, 5); assert.equal(f.tasks.size, 0);
  assert.equal(f.emit("click").defaultPrevented, true); f.dispose();
});

test("cancel, lost capture, sliding off, blur, page hide, visibility and disposal stop the hold", () => {
  for (const reason of ["pointercancel", "lostpointercapture", "move", "blur", "pagehide", "visibilitychange", "dispose"]) {
    const f = fixture(); f.emit("pointerdown"); f.tick(350);
    if (reason === "dispose") f.dispose();
    else if (reason === "move") f.emit("pointermove", { clientX: 80 });
    else f.emit(reason, {}, ["blur", "pagehide"].includes(reason) ? f.host : reason === "visibilitychange" ? f.visibility : f.button);
    f.tick(1000); assert.equal(f.calls.length, 2, reason); assert.equal(f.tasks.size, 0, reason); f.dispose();
  }
});

test("loading, completion, dialogs and rejected actions stop repeats until a fresh press", () => {
  for (const reason of ["available", "blocked", "accepted"]) {
    const f = fixture(); f.emit("pointerdown");
    f[reason](reason === "blocked"); f.tick(350);
    const count = f.calls.length;
    f[reason](reason !== "blocked"); f.tick(1000);
    assert.equal(f.calls.length, count, reason);
    f.emit("pointerup"); f.emit("pointerdown"); assert.equal(f.calls.length, count + 1); f.dispose();
  }
});

test("secondary touches and mouse input cannot start or steal a touch hold", () => {
  const f = fixture();
  f.emit("pointerdown", { pointerType: "mouse" });
  assert.equal(f.calls.length, 0); assert.equal(f.emit("click").defaultPrevented, false);
  f.emit("pointerdown");
  f.emit("pointerdown", { pointerId: 2, isPrimary: false });
  f.emit("pointerup", { pointerId: 2, isPrimary: false });
  f.tick(350); assert.equal(f.calls.length, 2); assert.equal(f.tasks.size, 1);
  f.emit("pointerup"); f.dispose();
});

test("unavailable or blocked buttons never start a hold", () => {
  for (const reason of ["available", "blocked"]) {
    const f = fixture(); f[reason](reason === "blocked"); f.emit("pointerdown"); f.tick(1000);
    assert.equal(f.calls.length, 0); assert.equal(f.tasks.size, 0); f.dispose();
  }
});
