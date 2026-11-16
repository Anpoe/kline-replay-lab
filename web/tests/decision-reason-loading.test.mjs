import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as plan from '../app/lib/decisionPlan.ts';
import * as workflow from '../app/lib/decisionWorkflow.ts';

const nodeRequire = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('../app/components/DecisionPlanCard.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exports = {};
new Function('require', 'exports', code)(id => id.includes('decisionPlan') ? plan : id.includes('decisionWorkflow') ? workflow : nodeRequire(id), exports);
const noop = () => {};
const props = {
  value: { marketState: '', location: '', reasons: [], stop: '', target: '', note: '' }, onChange: noop,
  reasonTags: ['顺势', '信号K确认', '高1/高2'], onPickPrice: noop, onDrawPosition: noop, onSubmit: noop, submitLabel: '保存',
  reasonEditor: { mode: '', onMode: noop, editingTag: '', editingValue: '', onStartEdit: noop, onEditValue: noop, onSaveEdit: noop, onCancelEdit: noop,
    customValue: '新理由', onCustomValue: noop, onAdd: noop, onDelete: noop },
};

test('loading never renders default or stale tags and disables editing in the legend and form', () => {
  const html = renderToStaticMarkup(createElement(exports.DecisionPlanCard, { ...props, reasonTagsState: 'loading' }));
  assert.match(html, /正在读取标签/);
  assert.doesNotMatch(html, /信号K确认|高1\/高2/);
  assert.match(html, /disabled="" aria-label="编辑交易理由标签"/);
  assert.match(html, /disabled="" aria-label="删除交易理由标签"/);
  assert.match(html, /aria-label="自定义交易理由标签" disabled=""/);
  assert.match(html, /aria-busy="true"/);
});

test('failed reads provide recovery without rendering fallback tags, while ready-empty stays empty', () => {
  const failed = renderToStaticMarkup(createElement(exports.DecisionPlanCard, { ...props, reasonTagsState: 'error', onRetryReasonTags: noop }));
  assert.match(failed, /标签未能读取/);
  assert.match(failed, /重试读取/);
  assert.doesNotMatch(failed, /信号K确认|高1\/高2/);
  const ready = renderToStaticMarkup(createElement(exports.DecisionPlanCard, { ...props, reasonTagsState: 'ready', reasonTags: [] }));
  assert.doesNotMatch(ready, /信号K确认|正在读取标签|标签未能读取/);
});

test('loaded tags use the saved catalogue with editing enabled', () => {
  const html = renderToStaticMarkup(createElement(exports.DecisionPlanCard, { ...props, reasonTagsState: 'ready', reasonTags: ['高1/高2'] }));
  assert.match(html, /高1\/高2/);
  assert.doesNotMatch(html, /信号K确认|正在读取标签/);
  assert.doesNotMatch(html, /disabled="" aria-label="编辑交易理由标签"/);
});
