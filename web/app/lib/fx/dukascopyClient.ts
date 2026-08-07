import {
  parseDukascopyCsvAsync,
  splitDukascopyCsvChunks,
  type DukascopyCsvOptions,
  type DukascopyParseResult,
} from "./dukascopyCsv.ts";

/**
 * Request values are deliberately source-neutral.  The configured URL builder
 * decides how the target export service names these parameters.
 */
export type DukascopyDownloadRequest = {
  instrument: string;
  start: string;
  end: string;
  timeframe?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: HeadersInit;
  signal?: AbortSignal;
};

export type DukascopyUrlBuilder = (request: DukascopyDownloadRequest) => string | URL;

export type DukascopyQueryUrlBuilderOptions = {
  endpoint: string | URL;
  parameterNames?: {
    instrument?: string;
    start?: string;
    end?: string;
    timeframe?: string;
  };
  staticQuery?: Record<string, string | number | boolean | null | undefined>;
};

export type DukascopyClientOptions = {
  urlBuilder?: DukascopyUrlBuilder;
  fetcher?: DukascopyFetcher;
  headers?: HeadersInit;
};

export type DukascopyFetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type DukascopyCsvDownload = {
  url: string;
  status: number;
  contentType: string | null;
  contentLength: number | null;
  chunks: AsyncIterable<Uint8Array>;
};

export class DukascopyClientError extends Error {
  readonly status?: number;
  readonly url: string;

  constructor(message: string, url: string, status?: number) {
    super(message);
    this.name = "DukascopyClientError";
    this.url = url;
    this.status = status;
  }
}

function defaultFetcher(input: string | URL, init?: RequestInit) {
  if (typeof globalThis.fetch !== "function") throw new Error("当前运行时没有可用的 fetch，请注入 DukascopyFetcher");
  return globalThis.fetch(input, init);
}

function setQueryValue(url: URL, key: string | undefined, value: unknown) {
  if (!key || value == null || value === "") return;
  url.searchParams.set(key, String(value));
}

/**
 * Builds a URL only from an explicitly supplied endpoint and parameter map.
 * No Dukascopy endpoint or undocumented parameter names are assumed here.
 */
export function createDukascopyQueryUrlBuilder(options: DukascopyQueryUrlBuilderOptions): DukascopyUrlBuilder {
  const names = {
    instrument: "instrument",
    start: "start",
    end: "end",
    timeframe: "timeframe",
    ...options.parameterNames,
  };
  return (request) => {
    const url = new URL(String(options.endpoint));
    for (const [key, value] of Object.entries(options.staticQuery ?? {})) setQueryValue(url, key, value);
    setQueryValue(url, names.instrument, request.instrument);
    setQueryValue(url, names.start, request.start);
    setQueryValue(url, names.end, request.end);
    setQueryValue(url, names.timeframe, request.timeframe);
    for (const [key, value] of Object.entries(request.query ?? {})) setQueryValue(url, key, value);
    return url;
  };
}

async function* responseChunks(response: Response): AsyncGenerator<Uint8Array> {
  if (!response.body) throw new Error("下载响应没有可读取的 body");
  const reader = response.body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value?.byteLength) yield next.value;
    }
  } finally {
    reader.releaseLock();
  }
}

export class DukascopyHistoricalClient {
  private readonly urlBuilder?: DukascopyUrlBuilder;
  private readonly fetcher: DukascopyFetcher;
  private readonly headers?: HeadersInit;

  constructor(options: DukascopyClientOptions = {}) {
    this.urlBuilder = options.urlBuilder;
    this.fetcher = options.fetcher ?? defaultFetcher;
    this.headers = options.headers;
  }

  buildUrl(request: DukascopyDownloadRequest) {
    if (!this.urlBuilder) {
      throw new Error("DukascopyHistoricalClient 需要注入 urlBuilder；官方导出地址和参数尚未在此硬编码");
    }
    return String(this.urlBuilder(request));
  }

  async downloadCsv(request: DukascopyDownloadRequest): Promise<DukascopyCsvDownload> {
    const url = this.buildUrl(request);
    const headers = new Headers(this.headers);
    new Headers(request.headers).forEach((value, key) => headers.set(key, value));
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "GET",
        headers,
        signal: request.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DukascopyClientError(`Dukascopy CSV 下载失败：${message}`, url);
    }
    if (!response.ok) {
      throw new DukascopyClientError(`Dukascopy CSV 下载返回 HTTP ${response.status}`, url, response.status);
    }
    return {
      url,
      status: response.status,
      contentType: response.headers.get("content-type"),
      contentLength: Number(response.headers.get("content-length")) || null,
      chunks: responseChunks(response),
    };
  }

  async *downloadCsvChunks(request: DukascopyDownloadRequest): AsyncGenerator<Uint8Array> {
    const download = await this.downloadCsv(request);
    for await (const chunk of download.chunks) yield chunk;
  }

  async *downloadCsvLines(request: DukascopyDownloadRequest): AsyncGenerator<string> {
    for await (const line of splitDukascopyCsvChunks(this.downloadCsvChunks(request))) yield line;
  }

  async downloadAndParseCsv(request: DukascopyDownloadRequest, options: DukascopyCsvOptions = {}): Promise<DukascopyParseResult> {
    return parseDukascopyCsvAsync(this.downloadCsvChunks(request), options);
  }
}
