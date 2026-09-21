import net from "node:net";
import { promisify } from "node:util";
import { inflate } from "node:zlib";

const inflateAsync = promisify(inflate);
const RESPONSE_HEADER_BYTES = 16;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_HOSTS = [
  // 优先使用经过实时数据验证的行情节点；握手成功不代表节点仍能返回报价。
  ["139.9.52.158", 7709],
  ["103.251.85.94", 7709],
  ["59.36.5.11", 7709],
  ["103.221.142.82", 7709],
  ["117.34.114.16", 7709],
  ["159.75.55.232", 7709],
  ["117.34.114.17", 7709],
  ["117.34.114.14", 7709],
  ["117.34.114.15", 7709],
  ["117.34.114.27", 7709],
  ["117.34.114.18", 7709],
  ["117.34.114.20", 7709],
  ["117.34.114.13", 7709],
  ["117.34.114.30", 7709],
  ["60.12.136.251", 7709],
  ["218.106.92.182", 7709],
  ["218.106.92.183", 7709],
  ["60.12.136.250", 7709],
  ["115.238.90.170", 7709],
  ["220.178.55.86", 7709],
  ["220.178.55.71", 7709],
  ["115.238.90.165", 7709],
  ["218.75.126.9", 7709],
  ["115.238.56.198", 7709],
  ["180.153.18.170", 7709],
  ["180.153.18.171", 7709],
  ["101.227.73.20", 7709],
  ["119.147.212.81", 7709],
  ["14.215.128.18", 7709],
  ["60.191.117.167", 7709],
  ["114.80.149.19", 7709],
  ["218.6.170.47", 7709],
];
const MAX_QUOTE_HOST_ATTEMPTS = 8;
const SETUP_PACKETS = [
  Buffer.from("0c0218930001030003000d0001", "hex"),
  Buffer.from("0c0218940001030003000d0002", "hex"),
  Buffer.from("0c031899000120002000db0fd5d0c9ccd6a4a8af0000008fc22540130000d500c9ccbdf0d7ea00000002", "hex"),
];
const CORPORATE_ACTIONS_PREFIX = Buffer.from("0c1f187600010b000b000f000100", "hex");
const QUOTES_REQUEST_HEADER_BYTES = 22;
const QUOTES_REQUEST_PREFIX = 0x02006320;
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

function normalizeSecurityQuoteInstrumentId(instrumentId) {
  const match = /^(\d{6})\.(SH|SZ|BJ)$/.exec(String(instrumentId).toUpperCase());
  if (!match) throw new Error("当前仅支持沪深京股票实时行情");
  return { instrumentId: `${match[1]}.${match[2]}`, code: match[1], market: match[2] === "SH" ? 1 : 0 };
}

export function buildTdxSecurityQuotesRequest(instrumentIds) {
  if (!Array.isArray(instrumentIds) || instrumentIds.length === 0) {
    throw new Error("实时行情请求至少需要一个品种");
  }
  const stocks = instrumentIds.map(normalizeSecurityQuoteInstrumentId);
  const packageDataLength = stocks.length * 7 + 12;
  const packet = Buffer.alloc(QUOTES_REQUEST_HEADER_BYTES + stocks.length * 7);
  packet.writeUInt16LE(0x10c, 0);
  packet.writeUInt32LE(QUOTES_REQUEST_PREFIX, 2);
  packet.writeUInt16LE(packageDataLength, 6);
  packet.writeUInt16LE(packageDataLength, 8);
  packet.writeUInt32LE(0x5053e, 10);
  packet.writeUInt32LE(0, 14);
  packet.writeUInt16LE(0, 18);
  packet.writeUInt16LE(stocks.length, 20);
  stocks.forEach((stock, index) => {
    const offset = QUOTES_REQUEST_HEADER_BYTES + index * 7;
    packet.writeUInt8(stock.market, offset);
    Buffer.from(stock.code, "ascii").copy(packet, offset + 1);
  });
  return packet;
}

export function buildTdxSecurityBarsRequest(instrumentId, {
  category = 9,
  start = 0,
  count = 800,
} = {}) {
  const stock = normalizeSecurityQuoteInstrumentId(instrumentId);
  const safeStart = Math.max(0, Math.min(65_535, Math.trunc(Number(start) || 0)));
  const safeCount = Math.max(1, Math.min(800, Math.trunc(Number(count) || 800)));
  const packet = Buffer.alloc(38);
  let offset = 0;
  packet.writeUInt16LE(0x10c, offset); offset += 2;
  packet.writeUInt32LE(0x01016408, offset); offset += 4;
  packet.writeUInt16LE(0x1c, offset); offset += 2;
  packet.writeUInt16LE(0x1c, offset); offset += 2;
  packet.writeUInt16LE(0x052d, offset); offset += 2;
  packet.writeUInt16LE(stock.market, offset); offset += 2;
  Buffer.from(stock.code, "ascii").copy(packet, offset); offset += 6;
  packet.writeUInt16LE(Math.max(0, Math.min(65_535, Math.trunc(Number(category) || 9))), offset); offset += 2;
  packet.writeUInt16LE(1, offset); offset += 2;
  packet.writeUInt16LE(safeStart, offset); offset += 2;
  packet.writeUInt16LE(safeCount, offset); offset += 2;
  packet.writeUInt32LE(0, offset); offset += 4;
  packet.writeUInt32LE(0, offset); offset += 4;
  packet.writeUInt16LE(0, offset);
  return packet;
}

function readTdxPrice(body, state) {
  if (state.offset >= body.length) throw new Error("实时行情响应不完整");
  let byte = body[state.offset++];
  const negative = Boolean(byte & 0x40);
  let value = byte & 0x3f;
  let shift = 6;
  while (byte & 0x80) {
    if (state.offset >= body.length) throw new Error("实时行情响应不完整");
    byte = body[state.offset++];
    value += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  }
  return negative ? -value : value;
}

function decodeTdxVolume(raw) {
  const logpoint = raw >>> 24;
  const hleax = (raw >>> 16) & 0xff;
  const lheax = (raw >>> 8) & 0xff;
  const lleax = raw & 0xff;
  const dwEcx = logpoint * 2 - 0x7f;
  const dwEdx = logpoint * 2 - 0x86;
  const dwEsi = logpoint * 2 - 0x8e;
  const dwEax = logpoint * 2 - 0x96;
  const first = 2 ** Math.abs(dwEcx);
  const base = dwEcx < 0 ? 1 / first : first;
  let middle;
  if (hleax > 0x80) {
    const scale = 2 ** (dwEdx + 1);
    middle = 2 ** dwEdx * 128 + (hleax & 0x7f) * scale;
  } else {
    middle = dwEdx >= 0 ? 2 ** dwEdx * hleax : (1 / 2 ** dwEdx) * hleax;
  }
  let low = 2 ** dwEsi * lheax;
  let tail = 2 ** dwEax * lleax;
  if (hleax & 0x80) {
    low *= 2;
    tail *= 2;
  }
  return base + middle + low + tail;
}

export function parseTdxSecurityQuotesResponse(input) {
  const body = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (body.length < 4) throw new Error("实时行情响应不完整");
  const count = body.readUInt16LE(2);
  const state = { offset: 4 };
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    if (state.offset + 9 > body.length) throw new Error("实时行情响应不完整");
    const market = body.readUInt8(state.offset);
    const code = body.subarray(state.offset + 1, state.offset + 7).toString("ascii");
    const active1 = body.readUInt16LE(state.offset + 7);
    state.offset += 9;
    const price = readTdxPrice(body, state);
    const lastCloseDiff = readTdxPrice(body, state);
    const openDiff = readTdxPrice(body, state);
    const highDiff = readTdxPrice(body, state);
    const lowDiff = readTdxPrice(body, state);
    readTdxPrice(body, state); // server time
    readTdxPrice(body, state); // unused reverse value
    const volume = readTdxPrice(body, state);
    readTdxPrice(body, state); // current volume
    if (state.offset + 4 > body.length) throw new Error("实时行情响应不完整");
    const turnover = decodeTdxVolume(body.readUInt32LE(state.offset));
    state.offset += 4;
    readTdxPrice(body, state); // sell volume
    readTdxPrice(body, state); // buy volume
    readTdxPrice(body, state);
    readTdxPrice(body, state);
    for (let quoteLevel = 0; quoteLevel < 5; quoteLevel += 1) {
      readTdxPrice(body, state); // bid price
      readTdxPrice(body, state); // ask price
      readTdxPrice(body, state); // bid volume
      readTdxPrice(body, state); // ask volume
    }
    if (state.offset + 2 > body.length) throw new Error("实时行情响应不完整");
    state.offset += 2;
    for (let unused = 0; unused < 4; unused += 1) readTdxPrice(body, state);
    if (state.offset + 4 > body.length) throw new Error("实时行情响应不完整");
    state.offset += 2; // price-speed field
    const active2 = body.readUInt16LE(state.offset);
    state.offset += 2;
    rows.push({
      instrumentId: `${code}.${market === 1 ? "SH" : "SZ"}`,
      market,
      code,
      active: Boolean(active1 || active2),
      price: price / 100,
      lastClose: (price + lastCloseDiff) / 100,
      open: (price + openDiff) / 100,
      high: (price + highDiff) / 100,
      low: (price + lowDiff) / 100,
      volume,
      turnover,
    });
  }
  return rows;
}

export function parseTdxSecurityBarsResponse(input, { assetType = "stock" } = {}) {
  const body = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (body.length < 2) throw new Error("历史日线响应不完整");
  const count = body.readUInt16LE(0);
  const state = { offset: 2 };
  const rows = [];
  let previousCloseBase = 0;
  for (let index = 0; index < count; index += 1) {
    if (state.offset + 4 > body.length) throw new Error("历史日线响应不完整");
    const compactDate = body.readUInt32LE(state.offset);
    state.offset += 4;
    const openDiff = readTdxPrice(body, state);
    const closeDiff = readTdxPrice(body, state);
    const highDiff = readTdxPrice(body, state);
    const lowDiff = readTdxPrice(body, state);
    if (state.offset + 8 > body.length) throw new Error("历史日线响应不完整");
    const volume = decodeTdxVolume(body.readUInt32LE(state.offset));
    state.offset += 4;
    const turnover = decodeTdxVolume(body.readUInt32LE(state.offset));
    state.offset += 4;
    // Index bars append rise/fall counts after amount; security bars do not.
    if (assetType === "index") {
      if (state.offset + 4 > body.length) throw new Error("历史指数日线响应不完整");
      state.offset += 4;
    }
    const openBase = previousCloseBase + openDiff;
    const closeBase = openBase + closeDiff;
    const highBase = openBase + highDiff;
    const lowBase = openBase + lowDiff;
    previousCloseBase = closeBase;
    const year = Math.trunc(compactDate / 10000);
    const month = Math.trunc((compactDate % 10000) / 100);
    const day = compactDate % 100;
    const timestamp = Date.UTC(year, month - 1, day);
    if (!Number.isFinite(timestamp) || year < 1990 || month < 1 || month > 12 || day < 1 || day > 31) continue;
    rows.push({
      timestamp,
      open: openBase / 1000,
      high: highBase / 1000,
      low: lowBase / 1000,
      close: closeBase / 1000,
      volume: Number.isFinite(volume) ? Math.round(volume) : null,
      turnover: Number.isFinite(turnover) ? Number(turnover.toFixed(2)) : null,
    });
  }
  return rows;
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
    this.hostCursor = 0;
  }

  getSocketError(message) {
    return new Error(`TDX 行情连接失败：${message}`);
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

  reset(error = new Error("TDX 行情连接已重置")) {
    const socket = this.socket;
    this.socket = null;
    this.readBuffer = Buffer.alloc(0);
    this.failRead(error);
    socket?.destroy();
  }

  readExact(size) {
    const value = this.takeBytes(size);
    if (value) return Promise.resolve(value);
    if (this.readWaiter) return Promise.reject(new Error("TDX 行情响应读取冲突"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.readWaiter?.timer !== timer) return;
        this.readWaiter = null;
        reject(new Error("TDX 行情响应超时"));
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
      if (this.socket === socket) this.reset(new Error("TDX 行情连接超时"));
    });
    socket.on("close", () => {
      if (this.socket === socket) {
        this.socket = null;
        this.failRead(new Error("TDX 行情连接已断开"));
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
    for (let offset = 0; offset < this.hosts.length; offset += 1) {
      const index = (this.hostCursor + offset) % this.hosts.length;
      const [host, port] = this.hosts[index];
      try {
        await this.openSocket(host, port);
        for (const packet of SETUP_PACKETS) await this.requestResponse(packet);
        this.hostCursor = (index + 1) % this.hosts.length;
        return;
      } catch (error) {
        lastError = error;
        this.reset(error);
      }
    }
    throw new Error(lastError
      ? `暂时无法连接 TDX 行情服务，请检查网络后重试（已尝试多个行情服务器；最近原因：${errorMessage(lastError)}）`
      : "暂时无法连接 TDX 行情服务，请检查网络后重试");
  }

  connect() {
    if (this.closed) return Promise.reject(new Error("TDX 行情服务已关闭"));
    if (this.socket && !this.socket.destroyed) return Promise.resolve();
    if (!this.connecting) {
      this.connecting = this.connectCandidates().finally(() => { this.connecting = null; });
    }
    return this.connecting;
  }

  async requestResponse(packet) {
    if (!this.socket || this.socket.destroyed) throw new Error("TDX 行情连接未建立");
    await new Promise((resolve, reject) => {
      this.socket.write(packet, error => error ? reject(error) : resolve());
    });
    const header = await this.readExact(RESPONSE_HEADER_BYTES);
    const compressedSize = header.readUInt16LE(12);
    const uncompressedSize = header.readUInt16LE(14);
    if (compressedSize > MAX_RESPONSE_BYTES || uncompressedSize > MAX_RESPONSE_BYTES) {
      throw new Error("TDX 行情响应过大，已停止读取");
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

  async fetchDailyQuotes(instrumentIds) {
    const request = buildTdxSecurityQuotesRequest(instrumentIds);
    const requested = new Map(instrumentIds.map((instrumentId) => {
      const stock = normalizeSecurityQuoteInstrumentId(instrumentId);
      return [`${stock.market}:${stock.code}`, stock.instrumentId];
    }));
    const requestedByCode = new Map(instrumentIds.map((instrumentId) => {
      const stock = normalizeSecurityQuoteInstrumentId(instrumentId);
      return [stock.code, stock.instrumentId];
    }));
    let lastError = null;
    const hostAttempts = Math.min(
      Math.max(1, this.hosts.length),
      MAX_QUOTE_HOST_ATTEMPTS,
    );
    for (let attempt = 0; attempt < hostAttempts; attempt += 1) {
      try {
        await this.connect();
        const rows = parseTdxSecurityQuotesResponse(await this.requestResponse(request));
        if (rows.length === 0) {
          lastError = new Error("行情节点未返回实时数据");
          this.reset(lastError);
          continue;
        }
        return rows.map((row) => ({
          ...row,
          instrumentId: requested.get(`${row.market}:${row.code}`)
            ?? requestedByCode.get(row.code)
            ?? row.instrumentId,
        }));
      } catch (error) {
        lastError = error;
        this.reset(error);
        if (this.closed) break;
      }
    }
    throw new Error(`实时日线行情请求失败：${errorMessage(lastError ?? new Error("未返回可用实时数据"))}`);
  }

  async fetchDailyBars(instrumentId, { assetType = "stock", start = 0, count = 800 } = {}) {
    const request = buildTdxSecurityBarsRequest(instrumentId, { start, count });
    let lastError = null;
    const hostAttempts = Math.min(
      Math.max(1, this.hosts.length),
      MAX_QUOTE_HOST_ATTEMPTS,
    );
    for (let attempt = 0; attempt < hostAttempts; attempt += 1) {
      try {
        await this.connect();
        const rows = parseTdxSecurityBarsResponse(
          await this.requestResponse(request),
          { assetType },
        );
        return rows.map((row) => ({ instrumentId, ...row }));
      } catch (error) {
        lastError = error;
        this.reset(error);
        if (this.closed) break;
      }
    }
    throw new Error(`历史日线请求失败：${errorMessage(lastError ?? new Error("未返回可用历史日线"))}`);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.reset(new Error("TDX 行情服务已关闭"));
  }
}
