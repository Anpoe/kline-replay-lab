import net from "node:net";
import { promisify } from "node:util";
import { inflate } from "node:zlib";

const inflateAsync = promisify(inflate);
const RESPONSE_HEADER_BYTES = 16;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_HOSTS = [
  ["180.153.18.170", 7709],
  ["180.153.18.171", 7709],
  ["101.227.73.20", 7709],
  ["119.147.212.81", 7709],
  ["14.215.128.18", 7709],
  ["60.191.117.167", 7709],
  ["114.80.149.19", 7709],
  ["218.6.170.47", 7709],
];
const SETUP_PACKETS = [
  Buffer.from("0c0218930001030003000d0001", "hex"),
  Buffer.from("0c0218940001030003000d0002", "hex"),
  Buffer.from("0c031899000120002000db0fd5d0c9ccd6a4a8af0000008fc22540130000d500c9ccbdf0d7ea00000002", "hex"),
];
const CORPORATE_ACTIONS_PREFIX = Buffer.from("0c1f187600010b000b000f000100", "hex");
const CATEGORY_NAMES = {
  1: "除权除息",
  2: "送配股上市",
  3: "非流通股上市",
  4: "未知股本变动",
  5: "股本变化",
  6: "增发新股",
  7: "股份回购",
  8: "增发新股上市",
  9: "转配股上市",
  10: "可转债上市",
  11: "扩缩股",
  12: "非流通股缩股",
  13: "送认购权证",
  14: "送认沽权证",
};

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function hostsFromEnvironment() {
  const configured = String(process.env.TDX_HQ_HOST ?? "").trim();
  if (configured) return [[configured, Number(process.env.TDX_HQ_PORT ?? 7709)]];
  return DEFAULT_HOSTS;
}

export function buildTdxCorporateActionsRequest(instrumentId) {
  const match = /^(\d{6})\.(SH|SZ)$/.exec(instrumentId);
  if (!match) throw new Error("当前仅支持沪深股票权息信息");
  const packet = Buffer.alloc(CORPORATE_ACTIONS_PREFIX.length + 7);
  CORPORATE_ACTIONS_PREFIX.copy(packet);
  packet.writeUInt8(match[2] === "SH" ? 1 : 0, CORPORATE_ACTIONS_PREFIX.length);
  Buffer.from(match[1], "ascii").copy(packet, CORPORATE_ACTIONS_PREFIX.length + 1);
  return packet;
}

export function parseTdxCorporateActionsResponse(input) {
  const body = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (body.length < 11) return [];
  let offset = 9;
  const count = body.readUInt16LE(offset);
  offset += 2;
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    if (offset + 29 > body.length) throw new Error("权息数据响应不完整");
    offset += 7; // market + code
    offset += 1; // reserved byte
    const compactDate = body.readUInt32LE(offset);
    offset += 4;
    const year = Math.trunc(compactDate / 10000);
    const month = Math.trunc((compactDate % 10000) / 100);
    const day = compactDate % 100;
    const category = body.readUInt8(offset);
    offset += 1;
    const row = {
      year,
      month,
      day,
      category,
      name: CATEGORY_NAMES[category] ?? String(category),
      fenhong: null,
      peigujia: null,
      songzhuangu: null,
      peigu: null,
      suogu: null,
      panqianliutong: null,
      panhouliutong: null,
      qianzongguben: null,
      houzongguben: null,
      fenshu: null,
      xingquanjia: null,
    };
    if (category === 1) {
      row.fenhong = body.readFloatLE(offset);
      row.peigujia = body.readFloatLE(offset + 4);
      row.songzhuangu = body.readFloatLE(offset + 8);
      row.peigu = body.readFloatLE(offset + 12);
    } else if (category === 11 || category === 12) {
      row.suogu = body.readFloatLE(offset + 8);
    } else if (category === 13 || category === 14) {
      row.xingquanjia = body.readFloatLE(offset);
      row.fenshu = body.readUInt32LE(offset + 8);
    }
    offset += 16;
    rows.push(row);
  }
  return rows;
}

export class TdxCorporateActionsClient {
  constructor(options = {}) {
    this.hosts = options.hosts ?? hostsFromEnvironment();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.socketFactory = options.socketFactory ?? ((host, port) => net.createConnection({ host, port }));
    this.socket = null;
    this.connecting = null;
    this.readBuffer = Buffer.alloc(0);
    this.readWaiter = null;
    this.closed = false;
  }

  getSocketError(message) {
    return new Error(`权息数据连接失败：${message}`);
  }

  takeBytes(size) {
    if (this.readBuffer.length < size) return null;
    const value = this.readBuffer.subarray(0, size);
    this.readBuffer = this.readBuffer.subarray(size);
    return value;
  }

  flushReadWaiter() {
    if (!this.readWaiter) return;
    const value = this.takeBytes(this.readWaiter.size);
    if (!value) return;
    const waiter = this.readWaiter;
    this.readWaiter = null;
    clearTimeout(waiter.timer);
    waiter.resolve(value);
  }

  failRead(error) {
    if (!this.readWaiter) return;
    const waiter = this.readWaiter;
    this.readWaiter = null;
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }

  reset(error = new Error("权息数据连接已重置")) {
    const socket = this.socket;
    this.socket = null;
    this.readBuffer = Buffer.alloc(0);
    this.failRead(error);
    socket?.destroy();
  }

  readExact(size) {
    const value = this.takeBytes(size);
    if (value) return Promise.resolve(value);
    if (this.readWaiter) return Promise.reject(new Error("权息数据响应读取冲突"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.readWaiter?.timer !== timer) return;
        this.readWaiter = null;
        reject(new Error("权息数据响应超时"));
      }, this.timeoutMs);
      this.readWaiter = { size, resolve, reject, timer };
      this.flushReadWaiter();
    });
  }

  async openSocket(host, port) {
    const socket = this.socketFactory(host, port);
    this.socket = socket;
    socket.setNoDelay?.(true);
    socket.setTimeout?.(this.timeoutMs);
    socket.on("data", chunk => {
      if (this.socket !== socket) return;
      this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
      this.flushReadWaiter();
    });
    socket.on("error", error => {
      if (this.socket === socket) this.failRead(this.getSocketError(errorMessage(error)));
    });
    socket.on("timeout", () => {
      if (this.socket === socket) this.reset(new Error("权息数据连接超时"));
    });
    socket.on("close", () => {
      if (this.socket === socket) {
        this.socket = null;
        this.failRead(new Error("权息数据连接已断开"));
      }
    });
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => finish(new Error("连接超时")), this.timeoutMs);
      socket.once("connect", () => finish());
      socket.once("error", error => finish(error));
    });
  }

  async connectCandidates() {
    let lastError = null;
    for (const [host, port] of this.hosts) {
      try {
        await this.openSocket(host, port);
        for (const packet of SETUP_PACKETS) await this.requestResponse(packet);
        return;
      } catch (error) {
        lastError = error;
        this.reset(error);
      }
    }
    throw new Error(lastError
      ? `暂时无法连接权息数据源，请检查网络后重试（已尝试多个行情服务器；最近原因：${errorMessage(lastError)}）`
      : "暂时无法连接权息数据源，请检查网络后重试");
  }

  connect() {
    if (this.closed) return Promise.reject(new Error("权息服务已关闭"));
    if (this.socket && !this.socket.destroyed) return Promise.resolve();
    if (!this.connecting) {
      this.connecting = this.connectCandidates().finally(() => { this.connecting = null; });
    }
    return this.connecting;
  }

  async requestResponse(packet) {
    if (!this.socket || this.socket.destroyed) throw new Error("权息数据连接未建立");
    await new Promise((resolve, reject) => {
      this.socket.write(packet, error => error ? reject(error) : resolve());
    });
    const header = await this.readExact(RESPONSE_HEADER_BYTES);
    const compressedSize = header.readUInt16LE(12);
    const uncompressedSize = header.readUInt16LE(14);
    if (compressedSize > MAX_RESPONSE_BYTES || uncompressedSize > MAX_RESPONSE_BYTES) {
      throw new Error("权息数据响应过大，已停止读取");
    }
    const body = await this.readExact(compressedSize);
    if (compressedSize === uncompressedSize) return body;
    return await inflateAsync(body);
  }

  async fetchEvents(instrumentId) {
    buildTdxCorporateActionsRequest(instrumentId);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.connect();
        const body = await this.requestResponse(buildTdxCorporateActionsRequest(instrumentId));
        return parseTdxCorporateActionsResponse(body);
      } catch (error) {
        this.reset(error);
        if (attempt === 1 || this.closed) {
          throw new Error(`权息数据请求失败：${errorMessage(error)}`);
        }
      }
    }
    throw new Error("权息数据请求失败");
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.reset(new Error("权息服务已关闭"));
  }
}
