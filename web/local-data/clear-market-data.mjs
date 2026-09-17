import { lstat, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { CorporateActionsStore } from './corporate-actions-store.mjs';

const busy = task => ['queued', 'running'].includes(task?.status);

export async function clearLocalMarketData(stores) {
  for (const store of Object.values(stores)) {
    if (store.running || store.maintenanceRunning || store.catalogRunning || store.corporateActions?.running
      || busy(store.task) || busy(store.catalogTask) || busy(store.maintenanceTask)
      || busy(store.corporateActions?.state.task)) {
      const error = new Error('A 股行情任务仍在处理中，请先暂停下载、行情更新和权息任务；名称更新请等待完成后重试。');
      error.status = 409;
      throw error;
    }
  }
  const root = path.resolve(stores.tdx.root);
  if (path.resolve(stores.baostock.root) !== root) throw new Error('行情目录不一致，未执行清空。');
  const names = ['baostock', 'tdx', 'packages', 'task.json', 'catalog-task.json', 'cn-maintenance-task.json',
    'baostock-task.json', 'baostock-catalog-task.json', 'baostock-cn-maintenance-task.json', 'catalog.json'];
  const targets = names.map(name => path.resolve(root, name));
  // Resolve and validate every destination before removing anything. Never
  // delete the data root, provider settings, or a linked external directory.
  for (const target of targets) {
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('行情目录无效，未执行清空。');
    const stat = await lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (stat?.isSymbolicLink()) throw new Error('行情目录包含外部链接，未执行清空。请检查数据存放位置。');
  }
  const { baostock, tdx } = stores;
  baostock.db?.close();
  baostock.db = null;
  tdx.overlayDb?.close();
  tdx.overlayDb = null;
  tdx.corporateActions.close();
  for (const store of Object.values(stores)) {
    store.task = null;
    store.catalogTask = null;
    store.maintenanceTask = null;
    store.manifestCache = null;
  }
  try {
    for (const target of targets) await rm(target, { recursive: true, force: true });
  } catch (error) {
    throw new Error('A 股行情清空未全部完成，已清理的内容无法撤销。请关闭占用行情文件的程序后重试。', { cause: error });
  } finally {
    await mkdir(baostock.dataDir, { recursive: true });
    baostock.ensureDb();
    tdx.corporateActions = await new CorporateActionsStore({ root, client: tdx.corporateActionsClient }).init();
  }
  return { market: 'CN', cleared: true };
}
