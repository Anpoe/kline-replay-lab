// Opt-in paging keeps existing training/snapshot consumers unchanged.
export function candlePageQuery(params) {
  if (!params.has('limit')) return null;
  const limit = Number(params.get('limit'));
  const before = params.has('before') ? Number(params.get('before')) : undefined;
  if (!Number.isInteger(limit) || limit < 1 || limit > 2000 || (before !== undefined && !Number.isFinite(before))) throw new Error('K 线分页范围无效');
  return { limit, before };
}

export function sliceCandlePage(candles, query) {
  if (!query) return { candles };
  const eligible = query.before === undefined ? candles : candles.filter(bar => bar.timestamp < query.before);
  return { candles: eligible.slice(-query.limit), hasBefore: eligible.length > query.limit };
}
