import type { Mt4CommandInput, Mt4Order, Mt4Status } from './mt4Contracts';
export type Mt4ProtectionField = 'stopLoss' | 'takeProfit';
export type Mt4ProtectionEdit = { accountKey: string; order: Mt4Order; field: Mt4ProtectionField | 'both'; commandId?: string };
export function prepareMt4Protection(input: { state: Mt4Status | null; edit: Mt4ProtectionEdit; values: Record<Mt4ProtectionField, string>; remove?: Mt4ProtectionField; id: string }): Mt4CommandInput | null;
