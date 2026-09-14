// The BaoStock implementation is the default local source.  The original
// TDX/Tushare implementation remains available as a separate provider so an
// existing installation can keep using it when the user explicitly selects
// that source.
export { BaoStockLocalStore } from "./baostock-store.mjs";
export { TdxLocalStore, normalizeTushareDailyRows } from "./legacy-tdx-store.mjs";
