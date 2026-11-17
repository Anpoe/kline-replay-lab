import { sha256Text } from "./snapshotStorage.ts";

// A UTF-16 slice has at most three UTF-8 bytes per code unit. Leave room for
// JSON escaping in both the upload request and the database result page.
export const SESSION_CHUNK_CHARACTERS = 16_384;
export const SESSION_CHUNK_BYTES = SESSION_CHUNK_CHARACTERS * 3;
export const SESSION_CHUNK_PAGE = 8;
export const SESSION_CHUNK_STORAGE = "session-chunks-v1";

export type SessionChunk = { index: number; hash: string; text: string };
export type SessionChunkPointer = {
  storage: typeof SESSION_CHUNK_STORAGE;
  revision: string;
  count: number;
};

export function sessionChunkPointer(text: string): SessionChunkPointer | null {
  try {
    const value = JSON.parse(text) as Partial<SessionChunkPointer> | null;
    return value?.storage === SESSION_CHUNK_STORAGE && typeof value.revision === "string"
      && Number.isSafeInteger(value.count) && Number(value.count) > 0
      ? value as SessionChunkPointer : null;
  } catch { return null; }
}

export async function chunkSessionState(state: Record<string, unknown>): Promise<SessionChunk[]> {
  const pieces: string[] = [];
  let buffer = "{";
  let separator = "";
  const append = (text: string) => {
    while (text.length) {
      let length = Math.min(SESSION_CHUNK_CHARACTERS - buffer.length, text.length);
      const last = text.charCodeAt(length - 1);
      if (length < text.length && last >= 0xd800 && last <= 0xdbff) length -= 1;
      buffer += text.slice(0, length);
      text = text.slice(length);
      if (buffer.length >= SESSION_CHUNK_CHARACTERS - 1) {
        pieces.push(buffer);
        buffer = "";
      }
    }
  };
  for (const [key, value] of Object.entries(state)) {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) continue;
    // Start large fields on their own boundary. Appending events leaves the
    // earlier chunks and the other large fields reusable by content hash.
    if (encoded.length >= SESSION_CHUNK_CHARACTERS && buffer) {
      pieces.push(buffer);
      buffer = "";
    }
    append(`${separator}${JSON.stringify(key)}:${encoded}`);
    if (encoded.length >= SESSION_CHUNK_CHARACTERS && buffer) {
      pieces.push(buffer);
      buffer = "";
    }
    separator = ",";
  }
  append("}");
  if (buffer) pieces.push(buffer);
  const chunks: SessionChunk[] = [];
  for (const [index, text] of pieces.entries()) {
    chunks.push({ index, text, hash: await sha256Text(text) });
  }
  return chunks;
}
