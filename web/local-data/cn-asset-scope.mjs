export const CN_ASSET_TYPES = new Set([
  "stock",
  "index",
  "fund",
  "convertible-bond",
  "other",
]);

export const DEFAULT_CN_ASSETS = Object.freeze(["stock", "index"]);

export function normalizeCnAssets(value) {
  const source = Array.isArray(value) ? value : DEFAULT_CN_ASSETS;
  const assets = [...new Set(source.filter((asset) => CN_ASSET_TYPES.has(asset)))];
  return assets.length ? assets : [...DEFAULT_CN_ASSETS];
}

export function filterCnInstruments(instruments, assets) {
  const selected = new Set(normalizeCnAssets(assets));
  return (Array.isArray(instruments) ? instruments : [])
    .filter((instrument) => selected.has(instrument.assetType ?? instrument.asset));
}
