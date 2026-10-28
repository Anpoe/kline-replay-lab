export type NotificationSound = { unlock(): Promise<boolean>; play(): boolean; preview(): Promise<boolean> };
export function createNotificationSound(createContext?: () => AudioContext): NotificationSound;
export const notificationSound: NotificationSound;
