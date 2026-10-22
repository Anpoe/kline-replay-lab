import { useSyncExternalStore } from 'react';

// Match the breakpoint that switches the main rail to the mobile bottom bar.
const desktopQuery = '(min-width: 921px)';
const serverSnapshot = () => false;
const desktopSnapshot = () => window.matchMedia(desktopQuery).matches;
function subscribe(onChange: () => void) {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
export function useDesktopLayout() {
  return useSyncExternalStore(subscribe, desktopSnapshot, serverSnapshot);
}
