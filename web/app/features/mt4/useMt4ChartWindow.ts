import { useEffect, useState } from 'react';
import type { KLineData } from 'klinecharts';
import { mt4ChartWindow, selectMt4ChartFrame, selectMt4FloatingFrame, type Mt4FloatingFrame, type Mt4FloatingInput, type Mt4CandleClock, type Mt4ChartFrame, type Mt4ChartMotionSettings } from '../../lib/mt4ChartWindow.mjs';

export function useMt4ChartWindow(bars: KLineData[], scope: string, settings: Mt4ChartMotionSettings, clock: Mt4CandleClock, floating: Mt4FloatingInput) {
  const [time, setTime] = useState(() => ({ now: Date.now(), monotonicNow: performance.now() }));
  useEffect(() => {
    if (!settings.enabled) return;
    const timer = setInterval(() => setTime({ now: Date.now(), monotonicNow: performance.now() }), 250);
    return () => clearInterval(timer);
  }, [settings.enabled]);
  const window = mt4ChartWindow({ ...clock, settings, openTime: bars.at(-1)?.timestamp ?? 0, now: Math.max(time.now, clock.receivedAt), monotonicNow: time.monotonicNow });
  const [stored, setStored] = useState<Mt4ChartFrame<KLineData> | null>(null);
  const frame = selectMt4ChartFrame(stored, { scope, bars, window });
  if (frame !== stored) setStored(frame);
  const [storedFloating, setStoredFloating] = useState<Mt4FloatingFrame | null>(null);
  const floatingFrame = selectMt4FloatingFrame(storedFloating, { ...floating, scope, barTimestamp: bars.at(-1)?.timestamp ?? 0, window });
  if (floatingFrame !== storedFloating) setStoredFloating(floatingFrame);
  return { bars: frame.bars, window, floating: floatingFrame };
}
