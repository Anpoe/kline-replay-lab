import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeJsonAtomic } from "../local-data/atomic-json.mjs";

test("atomic JSON writes serialize concurrent saves and leave valid progress", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kline-atomic-json-"));
  const target = path.join(root, "cn-maintenance-task.json");
  t.after(() => rm(root, { recursive: true, force: true }));

  await Promise.all(Array.from({ length: 24 }, (_, index) => writeJsonAtomic(target, {
    status: "running",
    processedInstruments: index,
  })));

  const saved = JSON.parse(await readFile(target, "utf8"));
  assert.equal(saved.status, "running");
  assert.ok(Number.isInteger(saved.processedInstruments));
  assert.deepEqual((await readdir(root)).filter(name => name.endsWith(".tmp")), []);
});
