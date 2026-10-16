export function normalizeFavoriteSymbols(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 80 && !/[\x00-\x1f]/.test(s)))].slice(0, 300) : [];
}
export function groupFavoriteSymbols<T extends { symbol: string }>(symbols: readonly T[], favorites: readonly string[]) {
  const names = new Set(favorites);
  return { favorites: symbols.filter(s => names.has(s.symbol)), others: symbols.filter(s => !names.has(s.symbol)) };
}
