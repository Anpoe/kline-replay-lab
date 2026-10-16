import type { KLineData } from 'klinecharts';
export function incrementalBarUpdates<T extends KLineData>(previous: T[], next: T[]): T[] | null;
