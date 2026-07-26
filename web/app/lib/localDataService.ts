const localDataOrigin = process.env.KLINE_DATA_SERVICE_URL ?? "http://127.0.0.1:3100";

export async function fetchLocalData(path: string, init?: RequestInit, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${localDataOrigin}${path}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function readLocalDataJson<T>(path: string, timeoutMs = 5000): Promise<T | null> {
  try {
    const response = await fetchLocalData(path, undefined, timeoutMs);
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}
