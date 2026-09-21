import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as persistence from "../app/lib/patternPresetPersistence.ts";
import { defaultPatternPresets } from "../app/lib/patternFilters.ts";

const routeSource = ts.transpileModule(
  readFileSync(new URL("../app/api/preferences/route.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function createRoute(t, initial) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  t.after(() => sqlite.close());
  if (initial) sqlite.prepare("INSERT INTO app_metadata VALUES (?, ?)")
    .run("training_preferences_v1", JSON.stringify(initial));
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() { return sqlite.prepare(sql).get(...args) ?? null; },
            async run() {
              return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } };
            },
          };
        },
      };
    },
  };
  const route = {};
  const require = (id) => {
    if (id === "../../../db/runtime") return { getRawDb: () => db, ensureSchema: async () => {} };
    if (id === "../../lib/patternPresetPersistence") return persistence;
    throw new Error(`Unexpected route dependency: ${id}`);
  };
  new Function("require", "exports", routeSource)(require, route);
  return route;
}

function preferences(hiddenIds = []) {
  return {
    version: 1,
    patternPresets: defaultPatternPresets.map((preset) => (
      hiddenIds.includes(preset.id) ? { ...preset, enabled: false } : preset
    )),
  };
}

function put(route, value) {
  return route.PUT(new Request("http://localhost/api/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  }));
}

async function hiddenIds(route) {
  const result = await (await route.GET()).json();
  return persistence.hiddenBuiltInPatternPresetIds(result.preferences.patternPresets).sort();
}

for (const initial of [undefined, preferences()]) {
  test(`a concurrent stale save cannot undo a saved hide (${initial ? "existing" : "new"} settings)`, async (t) => {
    const route = createRoute(t, initial);
    const id = defaultPatternPresets[0].id;
    // Both PUTs read the previous row before either write resumes.
    const responses = await Promise.all([put(route, preferences([id])), put(route, preferences())]);
    assert.ok(responses.every((response) => response.ok));
    assert.deepEqual(await hiddenIds(route), [id]);
  });
}

test("concurrent windows hiding different presets retain both choices", async (t) => {
  const route = createRoute(t, preferences());
  const ids = defaultPatternPresets.slice(0, 2).map((preset) => preset.id);
  await Promise.all(ids.map((id) => put(route, preferences([id]))));
  assert.deepEqual(await hiddenIds(route), ids.sort());
});

test("ordinary saves keep hidden presets and only an explicit restore clears them", async (t) => {
  const id = defaultPatternPresets[0].id;
  const route = createRoute(t, preferences([id]));
  await put(route, preferences());
  assert.deepEqual(await hiddenIds(route), [id]);
  assert.deepEqual(await (await put(route, {
    ...preferences(), patternPresetAction: persistence.PATTERN_PRESET_RESTORE_ACTION,
  })).json(), { saved: true });
  assert.deepEqual(await hiddenIds(route), []);
  const loaded = await (await route.GET()).json();
  assert.equal(loaded.preferences.patternPresetAction, undefined);
});

test("invalid and oversized preferences do not replace saved hidden presets", async (t) => {
  const id = defaultPatternPresets[0].id;
  const route = createRoute(t, preferences([id]));
  assert.equal((await put(route, [])).status, 400);
  assert.equal((await put(route, { ...preferences(), extra: "x".repeat(2 * 1024 * 1024) })).status, 413);
  assert.deepEqual(await hiddenIds(route), [id]);
});
