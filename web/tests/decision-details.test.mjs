import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { decisionPlanScore } from '../app/lib/decisionPlan.ts';

const source=readFileSync(new URL('../app/components/DecisionReview.tsx',import.meta.url),'utf8');
const parsed=ts.createSourceFile('review.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const body=parsed.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='DecisionDetails').getText(parsed).replace(/^export /,'');
const code=ts.transpileModule(body+'\nreturn DecisionDetails;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const noop=()=>null;
const Details=new Function('require','exports','decisionPlanScore','Pencil','Trash2','X',code)(createRequire(import.meta.url),{},decisionPlanScore,noop,noop,noop);
const record={id:'one',barTimestamp:1000,referencePrice:100,decision:{marketState:'反转尝试',location:'关键突破位',reasons:['顺势'],stop:'90',target:'120',note:'原计划说明'}};
const props={record,dateLabel:()=> '计划时间',priceLabel:String,onLocate:noop,onEdit:noop,onDelete:noop,onClose:noop,linkedTrades:createElement('div',{className:'trade-details'},'关联交易明细')};

test('chart plan detail is compact and shows only a leading linked badge when associated',()=>{
  const html=renderToStaticMarkup(createElement(Details,{...props,linkedTradeCount:1}));
  assert.ok(html.indexOf('已关联交易')<html.indexOf('反转尝试'));assert.match(html,/decision-linked-tag/);assert.match(html,/原计划说明/);
  for(const text of ['决策完成度','参考价','失效 / 止损','第一目标','关联交易明细','decision-chart-actions'])assert.ok(!html.includes(text),text);
  const plain=renderToStaticMarkup(createElement(Details,{...props,linkedTradeCount:0}));assert.ok(!plain.includes('已关联交易'));assert.ok(!plain.includes('尚未关联'));
});

test('the history record retains its prices and trade evidence',()=>{
  const html=renderToStaticMarkup(createElement(Details,{...props,history:true}));
  assert.match(html,/决策完成度/);assert.match(html,/参考价/);assert.match(html,/关联交易明细/);
});
