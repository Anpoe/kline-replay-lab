import { useEffect, useRef } from 'react';
import { shouldPlayMt4WindowSound, type Mt4WindowSoundFrame } from '../../lib/mt4ChartWindow.mjs';
import { notificationSound } from '../../lib/notificationSound.mjs';

export function useMt4WindowSound({ scope, window, settings }: Mt4WindowSoundFrame, onNotice: (message: string) => void) {
  const previous = useRef<Mt4WindowSoundFrame | null>(null);
  const { enabled, soundEnabled, startSeconds, endSeconds } = settings;
  useEffect(() => {
    if (!enabled || !soundEnabled) return;
    const unlock = () => { void notificationSound.unlock(); };
    if (navigator.userActivation?.hasBeenActive) unlock();
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    return () => {
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    };
  }, [enabled, soundEnabled]);
  useEffect(() => {
    const next = { scope, window, settings: { enabled, soundEnabled, startSeconds, endSeconds } };
    const notify = shouldPlayMt4WindowSound(previous.current, next);
    previous.current = next;
    if (notify && !notificationSound.play()) onNotice('提示音尚未就绪，请到 MT4 设置点击试听。');
  }, [scope, window, enabled, soundEnabled, startSeconds, endSeconds, onNotice]);
}
