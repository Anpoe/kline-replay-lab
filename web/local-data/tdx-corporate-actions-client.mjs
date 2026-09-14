import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export class TdxCorporateActionsClient {
  constructor(options = {}) {
    this.python = options.python ?? process.env.TDX_PYTHON ?? process.env.BAOSTOCK_PYTHON ?? 'python';
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.timeoutMs = options.timeoutMs ?? 25_000;
    this.child = null;
    this.pending = null;
    this.nextId = 0;
    this.closed = false;
  }

  reset(error) {
    const child = this.child;
    this.child = null;
    this.reader?.close();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = null;
    }
    child?.kill();
  }

  connect() {
    if (this.closed) throw new Error('权息服务已关闭');
    if (this.child) return;
    const child = this.spawnProcess(this.python, ['-u', fileURLToPath(new URL('./tdx_corporate_actions_bridge.py', import.meta.url))], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    this.child = child;
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-2000); });
    child.once('error', () => { if (this.child === child) this.reset(new Error('无法启动权息数据服务，请检查 Python 配置')); });
    child.stdin.on('error', () => { if (this.child === child) this.reset(new Error('权息数据服务连接中断')); });
    child.once('close', () => {
      if (this.child === child) this.reset(new Error(stderr.includes('No module named')
        ? '权息数据组件尚未安装，请安装数据服务依赖后重试' : '权息数据服务连接中断，请稍后重试'));
    });
    this.reader = createInterface({ input: child.stdout });
    this.reader.on('line', line => {
      let data;
      try { data = JSON.parse(line); } catch { return; }
      if (data.id !== this.pending?.id) return;
      const pending = this.pending;
      this.pending = null;
      clearTimeout(pending.timer);
      if (data.ok) pending.resolve(data.result);
      else pending.reject(new Error(data.error || '权息数据请求失败'));
    });
  }

  async fetchEvents(instrumentId) {
    if (!/^\d{6}\.(SH|SZ)$/.test(instrumentId)) throw new Error('当前仅支持沪深股票权息信息');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        this.connect();
        if (this.pending) throw new Error('已有权息请求正在进行');
        const id = ++this.nextId;
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => this.reset(new Error('权息数据请求超时，请稍后重试')), this.timeoutMs);
          this.pending = { id, resolve, reject, timer };
          this.child.stdin.write(`${JSON.stringify({ id, instrumentId })}\n`);
        });
      } catch (error) {
        this.reset(error);
        if (attempt === 1 || this.closed || /尚未安装|Python/.test(error.message)) throw error;
      }
    }
  }

  close() { this.closed = true; this.reset(new Error('权息服务已关闭')); }
}
