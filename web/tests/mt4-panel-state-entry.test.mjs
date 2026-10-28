import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the actual MQL CSV reader/writer. Broker math has separate coverage.
function compile(source, name, suffix = '') {
  const matches = [...source.matchAll(new RegExp(`bool ${name}\\(([\\s\\S]*?)\\)\\s*\\{`, 'g'))];
  const match = matches.find(m => m[1].includes('entryMode'));
  let end = match.index + match[0].length, depth = 1, start = end;
  while (depth) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
  const params = match[1].replace(/\b(?:bool|int|double|string)\s*&?/g, '').replace(/\[\]/g, '');
  const body = source.slice(start, end - 1).replace(/\b(?:int|double|bool|string) (\w+)\[BO_MAX_ROWS\];/g, 'var $1=Array(10);').replace(/\b(?:bool|int|double|string)\s+/g, 'var ');
  return new Function('api', `with(api){return function(${params}){var ok=(()=>{${body}})();return {ok${suffix}};}}`);
}
test('native panel remembers pending mode and price in existing state and accepts states without the new keys', async () => {
  const source = await readFile(new URL('../public/mt4/BatchOrderTemplate.mqh', import.meta.url), 'utf8');
  let values = [], cursor = 0;
  const api = { BO_MAX_ROWS: 10, BO_LOTS_FIXED: 0, BO_UNIT_PIPS: 0, BO_PANEL_STATE_VERSION: 3, BO_TEMPLATE_FOLDER: 'test', FILE_COMMON: 0, FILE_CSV: 0, FILE_READ: 0, FILE_WRITE: 0, FILE_ANSI: 0, FILE_SHARE_READ: 0, FILE_SHARE_WRITE: 0, INVALID_HANDLE: -1,
    MathIsValidNumber: Number.isFinite, BO_PanelStatePath: k => k, BO_SanitizeTemplateName: s => s, BO_ValidBridgePanelSettings: () => true, BO_ValidTemplateRows: () => true,
    ResetLastError: () => {}, FolderCreate: () => {}, FileOpen: () => { cursor = 0; return 1; }, FileClose: () => {}, FileIsExist: () => true, FileIsEnding: () => cursor >= values.length,
    FileReadString: () => String(values[cursor++]), FileWrite: (handle, key, value) => values.push(key, value), ArrayInitialize: (a, n) => a.fill(n),
    DoubleToString: (v, digits) => v.toFixed(digits), StrToInteger: s => Number(s), StrToDouble: Number, StringFormat: (s, ...args) => s.replace(/%[ds]/g, () => String(args.shift())),
  };
  const save = compile(source, 'BO_SavePanelState')(api), load = compile(source, 'BO_LoadPanelState', ',entryMode,pendingPrice,orderCount')(api);
  const units = Array(10).fill(0), stops = Array(10).fill(100), targets = Array(10).fill(200);
  assert.equal(save('key', 'XAUUSD', 3, 0, .05, 1, 20, false, true, false, 0, 50, 5, 30, 15, true, 10, 'default', units, stops, units, targets, '', 2, 2010).ok, true);
  const read = () => load('key', 'XAUUSD', '', 0, 0, 0, 0, 0, false, true, false, 0, 50, 5, 30, 15, true, 10, '', [], [], [], [], 0, 0, '');
  assert.deepEqual(read(), { ok: true, entryMode: 2, pendingPrice: 2010, orderCount: 3 });
  const current = values.slice(); values = values.slice(0, -4);
  assert.deepEqual(read(), { ok: true, entryMode: 0, pendingPrice: 0, orderCount: 3 });
  values = current; values[values.indexOf('entryMode') + 1] = 9; assert.equal(read().ok, false);
});
