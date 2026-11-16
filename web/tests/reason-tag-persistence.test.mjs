import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { normalizeReasonTags, defaultReasonTags } from '../app/features/settings/settingsGateway.ts';
import { mergeLegacyDecisionReasonTags, updateDeletedDecisionReasonTags } from '../app/lib/decisionPlan.ts';

const parse = path => ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const training = parse('../app/components/TrainingWorkbench.tsx');
const mt4 = parse('../app/features/mt4/components/Mt4ChartWorkbench.tsx');
function find(source, predicate) {
  let result;
  const visit = node => { if (predicate(node)) result = node; else ts.forEachChild(node, visit); };
  visit(source); assert.ok(result); return result;
}
function variable(name) {
  return find(training, node => ts.isVariableDeclaration(node) && node.name.getText(training) === name).initializer.getText(training);
}
function run(code, scope) {
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('scope', `with(scope){${compiled}}`)(scope);
}
function fixture() {
  const f = {
    reasonTags: [...defaultReasonTags], pendingReasonTagsRef: { current: null }, pendingReasonTagChangesRef: { current: null }, deletedReasonTagsRef: { current: [] }, normalizeReasonTags, reasonOptions: defaultReasonTags, updateDeletedDecisionReasonTags,
    setReasonTags: tags => { f.reasonTags = tags; }, setCustomReasonTags: () => {}, setDeletedReasonTags: () => {},
  };
  f.commit = run(`return ${variable('commitReasonTags')};`, f);
  const apply = find(training, node => ts.isVariableDeclaration(node) && node.name.getText(training) === 'applySyncedPreferences').initializer.arguments[0];
  const statements = apply.body.statements;
  const start = statements.findIndex(node => node.getText(training).startsWith('const syncedReasonTags'));
  const end = statements.findIndex(node => node.getText(training).startsWith('setCustomReasonTags(syncedCustomReasonTags)'));
  f.refresh = stored => run(statements.slice(start, end + 1).map(node => node.getText(training)).join('\n'), { ...f, stored });
  return f;
}

test('a focus refresh during the save delay cannot resurrect a confirmed reason-tag deletion', () => {
  const f = fixture(), stale = { reasonTags: [...f.reasonTags] };
  f.commit(f.reasonTags.filter(tag => tag !== '信号K确认'));
  f.refresh(stale);
  assert.ok(!f.reasonTags.includes('信号K确认'));
  f.commit([]); f.refresh(stale);
  assert.deepEqual(f.reasonTags, [], 'deleting the last tag also survives a stale refresh');
});

test('re-running the startup effect after hydration does not reset loaded custom reasons', () => {
  const effect = find(training, node => ts.isCallExpression(node) && node.expression.getText(training) === 'useEffect' && node.arguments[0]?.getText(training).includes('setReasonTagsReady(true)')).arguments[0].getText(training);
  let tags = ['顺势', '高1/高2', '50%', '靠近EMA'], custom = tags.slice(1);
  run(`(${effect})();`, { window: { setTimeout: fn => { fn(); return 1; }, clearTimeout() {} }, reasonOptions: defaultReasonTags,
    setReasonTags: value => { tags = value; }, setCustomReasonTags: value => { custom = value; }, setReasonTagsReady() {}, setCustomReasonTagsReady() {} });
  assert.deepEqual(tags, ['顺势', '高1/高2', '50%', '靠近EMA']);
  assert.deepEqual(custom, ['高1/高2', '50%', '靠近EMA']);
});

test('only explicit tag changes carry add/remove intent; consecutive edits preserve the pending intent', () => {
  const f = fixture();
  f.commit([...defaultReasonTags, '高1/高2']);
  f.commit([...defaultReasonTags.filter(tag => tag !== '信号K确认'), '高1/高2', '靠近EMA']);
  assert.deepEqual(f.pendingReasonTagChangesRef.current, { added: ['高1/高2', '靠近EMA'], removed: ['信号K确认'] });
  f.commit([...defaultReasonTags, '靠近EMA']);
  assert.deepEqual(f.pendingReasonTagChangesRef.current, { added: ['靠近EMA', '信号K确认'], removed: ['高1/高2'] });
});

test('save acknowledgements release only the matching local edit; failures and newer edits stay protected', async () => {
  const f = fixture(), requests = [], completions = [];
  Object.assign(f, {
    syncedPreferencesReady: true, syncedPreferencesHydratedRef: { current: true },
    patternPresetSaveRevisionRef: { current: 0 }, patternPresetsDirtyRef: { current: false }, patternPresetRestoreRequestedRef: { current: false },
    appSettingsRef: { current: {} }, settingsGateway: { removeLegacyCustomPatternPresets() {}, removeLegacyReasonTagPreferences() {} },
    buildSyncedPreferences: () => ({ reasonTags: f.pendingReasonTagsRef.current ?? f.reasonTags }),
    preferencesGateway: { save: prefs => { requests.push(prefs); return new Promise((resolve, reject) => completions.push({ resolve, reject })); } },
    window: { setTimeout: callback => { callback(); return 1; }, clearTimeout() {} }, setReasonTagSaveError() {},
  });
  const effect = find(training, node => ts.isCallExpression(node) && node.expression.getText(training) === 'useEffect' && node.arguments[0]?.getText(training).includes('const trackingPatternSave')).arguments[0].getText(training);
  const save = () => run(`(${effect})();`, f);
  const tick = () => new Promise(resolve => setImmediate(resolve));
  f.commit(['顺势']); save();
  f.commit([]); completions[0].resolve(); await tick();
  f.refresh({ reasonTags: defaultReasonTags }); assert.deepEqual(f.reasonTags, []);
  save(); completions[1].reject(Error('offline')); await tick();
  f.refresh({ reasonTags: defaultReasonTags }); assert.deepEqual(f.reasonTags, []);
  save(); completions[2].resolve(); await tick();
  assert.equal(f.pendingReasonTagsRef.current, null);
  f.refresh({ reasonTags: ['另一窗口新增'] }); assert.deepEqual(f.reasonTags, ['另一窗口新增']);
  assert.deepEqual(requests.map(item => item.reasonTags), [['顺势'], [], []]);
});

test('mounting an old MT4 chart imports custom tags without restoring defaults or explicitly deleted custom tags', () => {
  const effect = find(mt4, node => ts.isCallExpression(node) && node.expression.getText(mt4) === 'useEffect' && node.arguments[0]?.getText(mt4).includes('if (!sharedReasonTags) return')).arguments[0].getText(mt4);
  for (const sharedReasonTags of [['顺势'], []]) {
    const current = { current: { reasonTags: [...defaultReasonTags, '旧自定义'], draft: { reasons: ['信号K确认'] }, decisions: [] } };
    const writes = [], broadcasts = [];
    const scope = { sharedReasonTags, deletedReasonTags: [], current, readOnly: false, mergeLegacyDecisionReasonTags, reasonTagsInitialized: { current: false }, onReasonTagsChange: tags => broadcasts.push(tags), store: next => writes.push(next) };
    run(`(${effect})();`, scope);
    assert.deepEqual(broadcasts, [[...sharedReasonTags, '旧自定义']], 'unmigrated custom labels must survive');
    scope.reasonTagsInitialized.current = false; scope.deletedReasonTags = ['旧自定义']; broadcasts.length = 0;
    run(`(${effect})();`, scope);
    assert.deepEqual(broadcasts, [], 'explicitly deleted custom tags stay deleted');
    assert.deepEqual(writes[0].reasonTags, sharedReasonTags);
    assert.deepEqual(writes[0].draft.reasons, ['信号K确认'], 'saved/editor wording stays intact');
  }
});

test('legacy migration preserves the screenshot custom labels and respects deletion and explicit re-addition', () => {
  const custom = ['高1/高2', '50%', '靠近EMA'];
  assert.deepEqual(mergeLegacyDecisionReasonTags(['顺势'], [...defaultReasonTags, ...custom], []), ['顺势', ...custom]);
  const deleted = updateDeletedDecisionReasonTags(['顺势', ...custom], ['顺势', '50%'], []);
  assert.deepEqual(deleted, ['高1/高2', '靠近EMA']);
  assert.deepEqual(mergeLegacyDecisionReasonTags(['顺势', '50%'], custom, deleted), ['顺势', '50%']);
  assert.deepEqual(updateDeletedDecisionReasonTags(['顺势', '50%'], ['顺势', '50%', '靠近EMA'], deleted), ['高1/高2']);
});
