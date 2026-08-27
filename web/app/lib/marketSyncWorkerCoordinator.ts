export type MarketSyncWorkerCoordinator = {
  request<T>(runId: string, worker: () => Promise<T>): Promise<T>;
  clear(runId: string): void;
};

export type MarketSyncWorkerGate = {
  run<T>(
    runId: string,
    worker: () => Promise<T>,
    onBusy: () => Promise<T>,
  ): Promise<T>;
};

const marketSyncTerminalStatuses = new Set([
  "completed",
  "completed_with_errors",
  "cancelled",
  "paused",
]);

export function isMarketSyncTerminalStatus(status: unknown) {
  return typeof status === "string" && marketSyncTerminalStatuses.has(status);
}

export function shouldRefreshMarketSyncJobs(
  status: unknown,
  lastRefreshAt: number,
  now: number,
  minimumIntervalMs = 2_000,
) {
  return isMarketSyncTerminalStatus(status) || now - lastRefreshAt >= minimumIntervalMs;
}

type CoordinatorEntry = {
  promise: Promise<unknown>;
  settledAt: number | null;
};

export function createMarketSyncWorkerCoordinator(options: {
  cooldownMs?: number;
  now?: () => number;
} = {}): MarketSyncWorkerCoordinator {
  const cooldownMs = Math.max(0, options.cooldownMs ?? 300);
  const now = options.now ?? Date.now;
  const entries = new Map<string, CoordinatorEntry>();

  const request = <T>(runId: string, worker: () => Promise<T>) => {
    const current = entries.get(runId);
    if (current) {
      if (current.settledAt === null || now() - current.settledAt < cooldownMs) {
        return current.promise as Promise<T>;
      }
      entries.delete(runId);
    }

    const entry: CoordinatorEntry = {
      promise: Promise.resolve().then(worker),
      settledAt: null,
    };
    entry.promise = entry.promise.then(
      (value) => {
        if (entries.get(runId) === entry) entry.settledAt = now();
        return value;
      },
      (error) => {
        if (entries.get(runId) === entry) entries.delete(runId);
        throw error;
      },
    );
    entries.set(runId, entry);
    return entry.promise as Promise<T>;
  };

  return {
    request,
    clear(runId) {
      entries.delete(runId);
    },
  };
}

export function createMarketSyncWorkerGate(): MarketSyncWorkerGate {
  const active = new Map<string, Promise<unknown>>();

  return {
    async run<T>(
      runId: string,
      worker: () => Promise<T>,
      onBusy: () => Promise<T>,
    ) {
      if (active.has(runId)) return await onBusy();
      const pending = Promise.resolve().then(worker);
      active.set(runId, pending);
      try {
        return await pending;
      } finally {
        if (active.get(runId) === pending) active.delete(runId);
      }
    },
  };
}

export const marketSyncWorkerCoordinator = createMarketSyncWorkerCoordinator();
