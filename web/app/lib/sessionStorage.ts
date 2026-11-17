import {
  chunkSessionState, sessionChunkPointer, SESSION_CHUNK_BYTES,
  SESSION_CHUNK_PAGE, SESSION_CHUNK_STORAGE, type SessionChunk,
} from "./sessionChunks.ts";
import { sha256Text } from "./snapshotStorage.ts";

export type SessionMetadata = {
  id: string;
  instrumentId: string;
  timeframe: string;
  dataSnapshotId?: string | null;
};

type SaveRevision = {
  ordinal: number;
  id: string;
  sessionId: string;
  metadataJson: string;
  baseUpdatedAt: string | null;
  chunkCount: number;
  createdAt: string;
};

export class SessionStorageError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

async function readRevision(db: D1Database, sessionId: string, revision: string) {
  const row = await db.prepare(`SELECT rowid AS ordinal, id, session_id AS sessionId,
    metadata_json AS metadataJson, base_updated_at AS baseUpdatedAt,
    chunk_count AS chunkCount, created_at AS createdAt
    FROM training_save_revisions WHERE id = ? AND session_id = ?`)
    .bind(revision, sessionId).first<SaveRevision>();
  if (!row) throw new SessionStorageError("保存准备已过期，请重新保存", 409);
  return row;
}

export async function beginSessionSave(db: D1Database, metadata: SessionMetadata, revision: string, count: number,
  expectedUpdatedAt?: string, reuseRevision?: string) {
  if (!revision || revision.length > 100 || !Number.isSafeInteger(count) || count < 1) {
    throw new SessionStorageError("训练保存内容不完整");
  }
  const current = await db.prepare(`SELECT updated_at AS updatedAt, deleted_at AS deletedAt,
    CASE WHEN json_valid(state_json) THEN json_extract(state_json, '$.revision') END AS revision
    FROM training_sessions WHERE id = ?`)
    .bind(metadata.id).first<{ updatedAt: string; deletedAt: string | null; revision: string | null }>();
  if (current?.deletedAt) throw new SessionStorageError("训练已移入回收站，请先恢复训练", 409);
  if (expectedUpdatedAt !== undefined && current?.updatedAt !== expectedUpdatedAt) {
    // An acknowledged commit may be retried after its response was lost.
    const head = await db.prepare(`SELECT json_extract(state_json, '$.revision') AS revision
      FROM training_sessions WHERE id = ?`).bind(metadata.id).first<{ revision: string | null }>();
    if (head?.revision !== revision) throw new SessionStorageError("训练已在其他页面更新，请重新打开训练后再保存", 409);
  }
  if (reuseRevision && current?.revision !== reuseRevision && current?.revision !== revision) {
    throw new SessionStorageError("训练已在其他页面更新，请重新打开训练后再保存", 409);
  }
  const metadataJson = JSON.stringify({ ...metadata, ...(reuseRevision ? { reuseRevision } : {}) });
  await db.prepare(`INSERT OR IGNORE INTO training_save_revisions
    (id, session_id, metadata_json, base_updated_at, chunk_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(revision, metadata.id, metadataJson, current?.updatedAt ?? null, count, new Date().toISOString()).run();
  const stored = await readRevision(db, metadata.id, revision);
  if (stored.metadataJson !== metadataJson || stored.chunkCount !== count) {
    throw new SessionStorageError("保存内容已改变，请重新保存", 409);
  }
}

export async function putSessionChunks(
  db: D1Database, sessionId: string, revision: string,
  chunks: { index: number; hash: string; text?: string }[],
) {
  const save = await readRevision(db, sessionId, revision);
  if (!Array.isArray(chunks) || !chunks.length || chunks.length > SESSION_CHUNK_PAGE) {
    throw new SessionStorageError("训练保存分块不完整");
  }
  const missing: number[] = [];
  for (const chunk of chunks) {
    if (!Number.isSafeInteger(chunk.index) || chunk.index < 0 || chunk.index >= save.chunkCount
      || !/^[a-f0-9]{64}$/.test(chunk.hash)) throw new SessionStorageError("训练保存分块无效");
    const existing = await db.prepare(`SELECT chunk_hash AS hash FROM training_save_parts
      WHERE revision_id = ? AND sequence = ?`).bind(revision, chunk.index).first<{ hash: string }>();
    if (existing && existing.hash !== chunk.hash) throw new SessionStorageError("保存内容已改变，请重新保存", 409);
    if (chunk.text !== undefined) {
      if (typeof chunk.text !== "string" || new TextEncoder().encode(chunk.text).length > SESSION_CHUNK_BYTES
        || await sha256Text(chunk.text) !== chunk.hash) throw new SessionStorageError("训练保存分块校验失败");
      // Blob and reference become visible together. Repeated uploads are safe.
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO training_state_chunks (session_id, chunk_hash, payload_json) VALUES (?, ?, ?)")
          .bind(sessionId, chunk.hash, chunk.text),
        db.prepare("INSERT OR IGNORE INTO training_save_parts (revision_id, sequence, chunk_hash) VALUES (?, ?, ?)")
          .bind(revision, chunk.index, chunk.hash),
      ]);
    } else {
      await db.prepare(`INSERT OR IGNORE INTO training_save_parts (revision_id, sequence, chunk_hash)
        SELECT ?, ?, chunk_hash FROM training_state_chunks WHERE session_id = ? AND chunk_hash = ?`)
        .bind(revision, chunk.index, sessionId, chunk.hash).run();
      const part = await db.prepare("SELECT sequence FROM training_save_parts WHERE revision_id = ? AND sequence = ?")
        .bind(revision, chunk.index).first();
      if (!part) missing.push(chunk.index);
    }
  }
  return missing;
}

async function readChunkedState(db: D1Database, sessionId: string, revision: string, count: number) {
  const pieces: string[] = [];
  for (let offset = 0; offset < count; offset += SESSION_CHUNK_PAGE) {
    const page = await db.prepare(`SELECT p.sequence, p.chunk_hash AS hash, c.payload_json AS text
      FROM training_save_parts p JOIN training_state_chunks c ON c.chunk_hash = p.chunk_hash AND c.session_id = ?
      WHERE p.revision_id = ? AND p.sequence >= ? AND p.sequence < ? ORDER BY p.sequence`)
      .bind(sessionId, revision, offset, Math.min(count, offset + SESSION_CHUNK_PAGE))
      .all<SessionChunk & { sequence: number }>();
    if (page.results.length !== Math.min(SESSION_CHUNK_PAGE, count - offset)) {
      throw new SessionStorageError("训练保存尚未完成，请重新保存", 409);
    }
    for (const [index, chunk] of page.results.entries()) {
      if (chunk.sequence !== offset + index || await sha256Text(chunk.text) !== chunk.hash) {
        throw new SessionStorageError("训练保存校验失败，请重新保存", 409);
      }
      pieces.push(chunk.text);
    }
  }
  const text = pieces.join("");
  const state = JSON.parse(text) as unknown;
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new SessionStorageError("训练记录不完整");
  return text;
}

export async function commitSessionSave(db: D1Database, sessionId: string, revision: string) {
  const save = await readRevision(db, sessionId, revision);
  const pointer = JSON.stringify({ storage: SESSION_CHUNK_STORAGE, revision, count: save.chunkCount });
  const current = await db.prepare(`SELECT CASE WHEN length(state_json) < 1024 THEN state_json END AS stateJson,
    updated_at AS updatedAt FROM training_sessions WHERE id = ?`)
    .bind(sessionId).first<{ stateJson: string; updatedAt: string }>();
  if (current?.stateJson === pointer) return current.updatedAt;
  if ((current?.updatedAt ?? null) !== save.baseUpdatedAt) {
    throw new SessionStorageError("训练已在其他页面更新，请重新打开训练后再保存", 409);
  }
  const metadata = JSON.parse(save.metadataJson) as SessionMetadata & { reuseRevision?: string };
  if (metadata.reuseRevision) {
    await db.prepare(`INSERT OR IGNORE INTO training_save_parts (revision_id, sequence, chunk_hash)
      SELECT ?, sequence, chunk_hash FROM training_save_parts WHERE revision_id = ? AND sequence < ?`)
      .bind(revision, metadata.reuseRevision, save.chunkCount).run();
  }
  // Validate the complete revision before replacing the last usable checkpoint.
  await readChunkedState(db, sessionId, revision, save.chunkCount);
  const now = new Date(Math.max(Date.now(), Date.parse(save.baseUpdatedAt ?? "") + 1 || 0)).toISOString();
  const result = await db.prepare(`INSERT INTO training_sessions
    (id, instrument_id, timeframe, data_snapshot_id, state_json, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM training_save_revisions WHERE id = ?)
      AND (? IS NULL OR EXISTS
      (SELECT 1 FROM training_sessions WHERE id = ? AND updated_at = ? AND deleted_at IS NULL))
    ON CONFLICT(id) DO UPDATE SET instrument_id = excluded.instrument_id,
      timeframe = excluded.timeframe, data_snapshot_id = excluded.data_snapshot_id,
      state_json = excluded.state_json, updated_at = excluded.updated_at
    WHERE training_sessions.updated_at IS ? AND training_sessions.deleted_at IS NULL`)
    .bind(sessionId, metadata.instrumentId, metadata.timeframe, metadata.dataSnapshotId ?? null,
      pointer, now, now, revision, save.baseUpdatedAt, sessionId, save.baseUpdatedAt, save.baseUpdatedAt).run();
  if (!result.meta.changes) {
    const head = await db.prepare(`SELECT CASE WHEN length(state_json) < 1024 THEN state_json END AS stateJson,
      updated_at AS updatedAt FROM training_sessions WHERE id = ? AND deleted_at IS NULL`)
      .bind(sessionId).first<{ stateJson: string; updatedAt: string }>();
    if (head?.stateJson === pointer) return head.updatedAt;
    throw new SessionStorageError("训练已在其他页面更新，请重新打开训练后再保存", 409);
  }
  // Bound revision bookkeeping and discard superseded blobs. Later, concurrent
  // uploads retain their references. Readers retry against the new head.
  try {
    await db.batch([
      db.prepare(`DELETE FROM training_save_parts WHERE revision_id IN
        (SELECT id FROM training_save_revisions WHERE session_id = ? AND rowid < ? AND id <> ?
          AND id <> (SELECT json_extract(state_json, '$.revision') FROM training_sessions WHERE id = ?))`)
        .bind(sessionId, save.ordinal, revision, sessionId),
      db.prepare(`DELETE FROM training_save_revisions WHERE session_id = ? AND rowid < ? AND id <> ?
        AND id <> (SELECT json_extract(state_json, '$.revision') FROM training_sessions WHERE id = ?)`)
        .bind(sessionId, save.ordinal, revision, sessionId),
      db.prepare(`DELETE FROM training_state_chunks WHERE session_id = ? AND NOT EXISTS
        (SELECT 1 FROM training_save_parts p JOIN training_save_revisions r ON r.id = p.revision_id
          WHERE r.session_id = ? AND p.chunk_hash = training_state_chunks.chunk_hash)`)
        .bind(sessionId, sessionId),
    ]);
  } catch (error) {
    console.warn("Session checkpoint committed; deferred chunk cleanup", error);
  }
  return now;
}

export async function writeSessionState(db: D1Database, metadata: SessionMetadata, state: Record<string, unknown>,
  expectedUpdatedAt?: string) {
  const chunks = await chunkSessionState(state);
  const revision = crypto.randomUUID();
  await beginSessionSave(db, metadata, revision, chunks.length, expectedUpdatedAt);
  for (let offset = 0; offset < chunks.length; offset += SESSION_CHUNK_PAGE) {
    const page = chunks.slice(offset, offset + SESSION_CHUNK_PAGE);
    const missing = await putSessionChunks(db, metadata.id, revision, page.map(({ index, hash }) => ({ index, hash })));
    if (missing.length) await putSessionChunks(db, metadata.id, revision, page.filter(chunk => missing.includes(chunk.index)));
  }
  return commitSessionSave(db, metadata.id, revision);
}

export async function readSessionState(db: D1Database, sessionId: string, stored: string | null): Promise<string> {
  const pointer = stored ? sessionChunkPointer(stored) : null;
  if (pointer) {
    try {
      return await readChunkedState(db, sessionId, pointer.revision, pointer.count);
    } catch (error) {
      const head = await db.prepare("SELECT state_json AS stateJson FROM training_sessions WHERE id = ?")
        .bind(sessionId).first<{ stateJson: string }>();
      if (!head || head.stateJson === stored) throw error;
      return readSessionState(db, sessionId, head.stateJson);
    }
  }
  if (stored !== null) return stored;
  // Existing single-row states are read in bounded pieces as well. No eager
  // rewrite is required to open a large record created before chunked saves.
  const readHead = () => db.prepare(`SELECT updated_at AS updatedAt,
    CASE WHEN length(state_json) < 1024 THEN state_json END AS stateJson FROM training_sessions WHERE id = ?`)
    .bind(sessionId).first<{ updatedAt: string; stateJson: string | null }>();
  const before = await readHead();
  if (before?.stateJson != null) return readSessionState(db, sessionId, before.stateJson);
  const pieces: string[] = [];
  for (let offset = 1; ; offset += 8_192) {
    const row = await db.prepare("SELECT substr(state_json, ?, 8192) AS piece FROM training_sessions WHERE id = ?")
      .bind(offset, sessionId).first<{ piece: string }>();
    if (!row) throw new SessionStorageError("训练记录不存在", 404);
    pieces.push(row.piece);
    // SQLite substr counts Unicode code points, including supplementary ones.
    if ([...row.piece].length < 8_192) break;
  }
  const after = await readHead();
  if (after?.updatedAt !== before?.updatedAt) return readSessionState(db, sessionId, after?.stateJson ?? null);
  return pieces.join("");
}
