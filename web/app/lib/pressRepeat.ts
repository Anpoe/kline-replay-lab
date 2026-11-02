type TimerToken = ReturnType<typeof setTimeout> | number;
type RepeatOptions = {
  repeatIntervalMs: number;
  onAction: () => boolean | void;
  isAvailable: () => boolean;
  isBlocked: () => boolean;
  setTimer?: (fn: () => void, delay: number) => TimerToken;
  clearTimer?: (token: TimerToken) => void;
};

// Keyboard and touch share the delay, cadence and boundary checks.
export function createPressRepeat({ repeatIntervalMs, onAction, isAvailable, isBlocked,
  setTimer = setTimeout, clearTimer = clearTimeout }: RepeatOptions) {
  let timer: TimerToken | null = null;
  let active = false;
  const cancel = () => {
    active = false;
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const repeat = () => {
    timer = null;
    if (!active || isBlocked() || !isAvailable() || onAction() === false) { cancel(); return; }
    if (active) timer = setTimer(repeat, repeatIntervalMs);
  };
  return {
    cancel,
    start: () => { cancel(); active = true; timer = setTimer(repeat, 350); },
  };
}

export function installPointerRepeat({ target, host, visibilityTarget, ...options }: RepeatOptions & {
  target: HTMLElement;
  host: EventTarget;
  visibilityTarget: EventTarget;
}) {
  const repeater = createPressRepeat(options);
  let pointerId: number | null = null;
  let suppressClick = false;
  const cancel = () => {
    repeater.cancel();
    const captured = pointerId;
    pointerId = null;
    if (captured !== null && target.hasPointerCapture?.(captured)) target.releasePointerCapture(captured);
  };
  const down = (raw: Event) => {
    const event = raw as PointerEvent;
    if (event.pointerType === "mouse") { cancel(); suppressClick = false; return; }
    if (!event.isPrimary || event.button !== 0 || pointerId !== null || options.isBlocked() || !options.isAvailable()) return;
    event.preventDefault();
    pointerId = event.pointerId;
    suppressClick = true;
    target.setPointerCapture?.(event.pointerId);
    if (options.onAction() === false) { cancel(); return; }
    repeater.start();
  };
  const end = (raw: Event) => { if ((raw as PointerEvent).pointerId === pointerId) cancel(); };
  const move = (raw: Event) => {
    const event = raw as PointerEvent;
    if (event.pointerId !== pointerId) return;
    const bounds = target.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) cancel();
  };
  const click = (raw: Event) => {
    if (suppressClick && (raw as MouseEvent).detail !== 0) {
      suppressClick = false;
      raw.preventDefault(); raw.stopImmediatePropagation();
    }
  };
  const contextMenu = (event: Event) => { if (pointerId !== null) event.preventDefault(); };
  target.addEventListener("pointerdown", down);
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", end);
  target.addEventListener("pointercancel", end);
  target.addEventListener("lostpointercapture", end);
  target.addEventListener("click", click, true);
  target.addEventListener("contextmenu", contextMenu);
  host.addEventListener("blur", cancel);
  host.addEventListener("pagehide", cancel);
  visibilityTarget.addEventListener("visibilitychange", cancel);
  return () => {
    cancel();
    target.removeEventListener("pointerdown", down);
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", end);
    target.removeEventListener("pointercancel", end);
    target.removeEventListener("lostpointercapture", end);
    target.removeEventListener("click", click, true);
    target.removeEventListener("contextmenu", contextMenu);
    host.removeEventListener("blur", cancel);
    host.removeEventListener("pagehide", cancel);
    visibilityTarget.removeEventListener("visibilitychange", cancel);
  };
}
