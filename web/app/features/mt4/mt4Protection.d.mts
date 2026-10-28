import type { Mt4Command, Mt4CommandInput, Mt4Order, Mt4Status } from './mt4Contracts';
import type { ProtectionLine } from '../../lib/tradeProtection';
export type Mt4ProtectionField = 'stopLoss' | 'takeProfit';
export type Mt4ProtectionEdit = { accountKey: string; order: Mt4Order; field: Mt4ProtectionField | 'both'; commandId?: string };
export function prepareMt4Protection(input: { state: Mt4Status | null; edit: Mt4ProtectionEdit; values: Record<Mt4ProtectionField, string>; remove?: Mt4ProtectionField; id: string }): Mt4CommandInput | null;
export type Mt4OrderProtectionLine = ProtectionLine & { accountKey: string; order: Mt4Order; field: Mt4ProtectionField | 'entry' };
export function deriveMt4OrderProtectionLines(input: { state: Mt4Status | null; symbol: string; timestamp: number; digits: number; movable: boolean; pending?: (Mt4CommandInput & { status?: Mt4Command['status'] }) | null }): Mt4OrderProtectionLine[];
export function prepareMt4ProtectionDrag(input: { state: Mt4Status | null; line: Mt4OrderProtectionLine; price: number; id: string }): Mt4CommandInput | null;
