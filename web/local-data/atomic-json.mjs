import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const transientRenameErrors = new Set(["EACCES", "EBUSY", "EPERM", "EEXIST", "ENOTEMPTY"]);
const retryDelays = [25, 50, 100, 200, 400, 800];
const pendingWrites = new Map();

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function writeJsonAtomicNow(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temporary, target);
        return;
      } catch (error) {
        if (!transientRenameErrors.has(error?.code) || attempt >= retryDelays.length) throw error;
        await wait(retryDelays[attempt]);
      }
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export function writeJsonAtomic(target, value) {
  const previous = pendingWrites.get(target) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => writeJsonAtomicNow(target, value));
  pendingWrites.set(target, next);
  return next.finally(() => {
    if (pendingWrites.get(target) === next) pendingWrites.delete(target);
  });
}
