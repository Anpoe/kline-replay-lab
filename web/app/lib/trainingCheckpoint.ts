import { chunkSessionState } from "./sessionChunks.ts";

type CheckpointHead = { key: string; id: string; updatedAt: unknown; hashes: string[]; acknowledged?: boolean };
let pendingWrite: Promise<unknown> = Promise.resolve();

function openCheckpointDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("浏览器保存点暂不可用"));
    const request = indexedDB.open("kline-training-checkpoints", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("heads", { keyPath: "key" });
      request.result.createObjectStore("chunks", { keyPath: "hash" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("请关闭其他训练页面后重试保存"));
  });
}

export function saveTrainingCheckpoint(draft: { id: string } & Record<string, unknown>): Promise<void> {
  const write = pendingWrite.catch(() => {}).then(async () => {
    const chunks = await chunkSessionState(draft);
    const db = await openCheckpointDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(["heads", "chunks"], "readwrite");
        const heads = transaction.objectStore("heads");
        const blobs = transaction.objectStore("chunks");
        const hashes = chunks.map(chunk => chunk.hash);
        const keep = new Set(hashes);
        const previous = heads.get("last");
        previous.onsuccess = () => {
          for (const hash of (previous.result as CheckpointHead | undefined)?.hashes ?? []) {
            if (!keep.has(hash)) blobs.delete(hash);
          }
        };
        for (const chunk of chunks) {
          const existing = blobs.get(chunk.hash);
          existing.onsuccess = () => {
            if (!existing.result) blobs.put({ hash: chunk.hash, text: chunk.text });
          };
        }
        heads.put({ key: "last", id: draft.id, updatedAt: draft.updatedAt, hashes } satisfies CheckpointHead);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error("浏览器保存点未完成"));
        transaction.onerror = () => {};
      });
    } finally {
      db.close();
    }
  });
  pendingWrite = write;
  return write;
}

export async function loadTrainingCheckpoint<T>(): Promise<T | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openCheckpointDb();
  try {
    const checkpoint = await new Promise<T | null>((resolve, reject) => {
      const transaction = db.transaction(["heads", "chunks"], "readonly");
      const request = transaction.objectStore("heads").get("last");
      const pieces: string[] = [];
      let hasHead = false;
      let acknowledged = false;
      request.onsuccess = () => {
        const head = request.result as CheckpointHead | undefined;
        if (!head) return;
        hasHead = true;
        acknowledged = head.acknowledged === true;
        for (const [index, hash] of head.hashes.entries()) {
          const part = transaction.objectStore("chunks").get(hash);
          part.onsuccess = () => {
            if (!part.result) return transaction.abort();
            pieces[index] = part.result.text;
          };
        }
      };
      transaction.oncomplete = () => {
        try {
          const draft = hasHead ? JSON.parse(pieces.join("")) as T : null;
          resolve(draft && typeof draft === "object" ? { ...draft, checkpointAcknowledged: acknowledged } : draft);
        }
        catch (error) { reject(error); }
      };
      transaction.onabort = () => reject(transaction.error ?? new Error("浏览器保存点读取失败"));
      transaction.onerror = () => {};
    });
    // Read the existing browser checkpoint until the first chunked save has
    // committed. Importing it never removes the original recovery copy.
    if (checkpoint !== null) return checkpoint;
    try {
      const legacy = localStorage.getItem("kline-replay-lab:last-training");
      return legacy ? JSON.parse(legacy) as T : null;
    } catch { return null; }
  } finally {
    db.close();
  }
}

export function removeTrainingCheckpoint(sessionId: string): Promise<void> {
  const remove = pendingWrite.catch(() => {}).then(async () => {
    if (typeof indexedDB === "undefined") return;
    const db = await openCheckpointDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(["heads", "chunks"], "readwrite");
        const heads = transaction.objectStore("heads");
        const request = heads.get("last");
        request.onsuccess = () => {
          const head = request.result as CheckpointHead | undefined;
          if (head?.id !== sessionId) return;
          heads.delete("last");
          for (const hash of head.hashes) transaction.objectStore("chunks").delete(hash);
        };
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { db.close(); }
  });
  pendingWrite = remove;
  return remove;
}

export async function acknowledgeTrainingCheckpoint(sessionId: string, updatedAt: string): Promise<void> {
  await pendingWrite.catch(() => {});
  const db = await openCheckpointDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("heads", "readwrite");
      const heads = transaction.objectStore("heads");
      const request = heads.get("last");
      request.onsuccess = () => {
        const head = request.result as CheckpointHead | undefined;
        if (head?.id === sessionId && head.updatedAt === updatedAt) heads.put({ ...head, acknowledged: true });
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
