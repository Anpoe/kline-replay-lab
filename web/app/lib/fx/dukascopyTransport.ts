type BrowserReply = { status: number; headers?: Record<string, string>; body: string };

export function createDukascopyFetcher({
  fetchImpl = (input: string | URL, init?: RequestInit) => globalThis.fetch(input, init),
  localFetchImpl = (input: string | URL, init?: RequestInit) => globalThis.fetch(input, init),
  localOrigin = process.env.KLINE_DATA_SERVICE_URL ?? "http://127.0.0.1:3100",
} = {}) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    init?.signal?.throwIfAborted();
    const url = new URL(input);
    const eligible = (!init?.method || init.method === "GET") && url.origin === "https://jetta.dukascopy.com" && /^\/v1\/(?:instruments\/|candles\/minute\/)/.test(url.pathname) && !url.search;
    let response: Response | undefined;
    try {
      response = await fetchImpl(input, init);
    } catch (error) {
      init?.signal?.throwIfAborted();
      if (!eligible) throw error;
      // Workers can disconnect before returning the edge's 202 challenge.
      // Use the same bounded local transport for this network failure.
    }
    if (response && (!eligible || (response.status !== 202 && response.headers.get("x-amzn-waf-action") !== "challenge"))) return response;
    init?.signal?.throwIfAborted();
    await response?.body?.cancel();
    let localResponse: Response;
    try {
      localResponse = await localFetchImpl(`${localOrigin}/dukascopy/json`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: url.pathname }), signal: init?.signal, cache: "no-store",
      });
    } catch (error) {
      init?.signal?.throwIfAborted();
      void error;
      return Response.json({ error: "免费行情连接尚未准备好，请在控制面板重启服务后重试" }, { status: 409 });
    }
    if (localResponse.status === 404) return Response.json({ error: "请在控制面板重启服务后重试免费行情连接" }, { status: 409 });
    if (!localResponse.ok) return localResponse;
    const payload = await localResponse.json() as BrowserReply;
    init?.signal?.throwIfAborted();
    if (!Number.isInteger(payload.status) || payload.status < 200 || payload.status > 599 || typeof payload.body !== "string") {
      return Response.json({ error: "免费行情连接返回无效数据，请重启服务后重试" }, { status: 502 });
    }
    return new Response([204, 205, 304].includes(payload.status) ? null : payload.body, { status: payload.status, headers: payload.headers });
  };
}

export const fetchDukascopy = createDukascopyFetcher();
