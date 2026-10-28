/** One local player shared by preview and automatic notifications. */
export function createNotificationSound(createContext = () => new globalThis.AudioContext()) {
  let context;
  const unlock = async () => {
    try {
      if (!context || context.state === 'closed') context = createContext();
      if (context.state !== 'running') await context.resume();
      return context.state === 'running';
    } catch { return false; }
  };
  const play = () => {
    // Never retain a blocked notification to play after a later interaction.
    if (context?.state !== 'running') return false;
    let oscillator, gain;
    try {
      const time = context.currentTime;
      oscillator = context.createOscillator(); gain = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(880, time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.035, time + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(time); oscillator.stop(time + 0.2);
      return true;
    } catch { oscillator?.disconnect(); gain?.disconnect(); return false; }
  };
  return { unlock, play, preview: async () => await unlock() && play() };
}

export const notificationSound = createNotificationSound();
