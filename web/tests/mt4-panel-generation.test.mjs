import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('regenerating the integrated EA preserves its native pending UI, handlers and shared math', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mt4-panel-generation-')); t.after(() => rm(root, { recursive: true, force: true }));
  const source = fileURLToPath(new URL('../public/mt4/BatchOrderPanelEA.mq4', import.meta.url));
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../scripts/integrate-mt4-panel.mjs', import.meta.url)), source, root, path.join(root, 'manifest.json')], { windowsHide: true });
  const decode = bytes => bytes.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  assert.equal(decode(await readFile(path.join(root, 'BatchOrderPanelEA.mq4'))), decode(await readFile(source)));
  assert.deepEqual(await readFile(path.join(root, 'BatchOrderMath.mqh')), await readFile(new URL('../public/mt4/BatchOrderMath.mqh', import.meta.url)));
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.panelVersion, '1.15');
  const panel = decode(await readFile(source));
  for (const side of ['BUY', 'SELL']) assert.ok(panel.includes(`ExecuteBatch(BO_EntryOrderType(OP_${side}, gOrderMode), 0, gPendingPrice);`));
});
