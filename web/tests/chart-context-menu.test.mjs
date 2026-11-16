import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { pendingOrderIdsAtPrice } from '../app/lib/chartTrading.ts';
import { entryProtectionError, pendingPriceError } from '../app/lib/orderPriceValidation.ts';
import { createEmptyDecisionPlan, hasDecisionPlanContent, validateDecisionPlan, updateDecisionRecord, commitDecisionRecord, draftAfterDecisionSaved } from '../app/lib/decisionWorkflow.ts';
import { decisionValue, mt4Draft } from '../app/features/mt4/mt4Analysis.ts';

function callbacks(path, names) {
  const parsed=ts.createSourceFile(path,readFileSync(new URL(path,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const found=new Map();
  const visit=node=>{if(ts.isVariableDeclaration(node)&&names.includes(node.name.getText(parsed)))found.set(node.name.getText(parsed),node.initializer.getText(parsed));ts.forEachChild(node,visit);};
  visit(parsed);
  return ts.transpileModule(names.map(name=>`const ${name}=${found.get(name)};`).join('\n')+`\nreturn {${names.join(',')}};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
const code=callbacks('../app/components/KLineReplayChart.tsx',['rememberDrawingContext','rememberMarkerContext','triggerCandleContext','handleContextMouseDown','handleContextMenu']);
function fixture(overrides={}) {
  const decisions=[],menus=[],candle={dataIndex:7,timestamp:1000,referencePrice:2000};
  const context={useCallback:fn=>fn,enableCandleContextMenu:true,drawingActive:false,priceSelectionMode:null,trading:{scope:'chart-a',normalizePrice:price=>price,onOpen(){}},
    resolvePriceAt:(_x,y)=>y,resolveCandleAt:()=>candle,pricePrecision:2,pendingOrderIdsAtPrice,
    cancelLongPress(){},setTradingTarget:target=>{if(target)menus.push(target);else context.closed=true;},lastContextTriggerRef:{current:null},contextOperationRef:{current:null},
    onCandleContextMenuRef:{current:(...args)=>decisions.push(args)},...overrides};
  const runtime=new Function('context',`with(context){${code}}`)(context);
  return {context,decisions,menus,candle,runtime,right(){runtime.handleContextMenu({clientX:120,clientY:1990,preventDefault(){}});}};
}

test('one right-click opens trading at the pointer price and the original candle decision simultaneously',()=>{
  const f=fixture();f.right();
  assert.equal(f.menus.length,1);assert.equal(f.menus[0].price,1990);
  assert.deepEqual(f.decisions,[[f.candle,{preserveChartViewport:true}]]);
  assert.equal(f.menus[0].candle.referencePrice,2000,'decision reference remains the candle close');
});
test('pending order interaction replaces general trading and decision backfill',()=>{
  const f=fixture({trading:{scope:'chart-a',cancellation:{orders:[{id:'pending',price:1990}]}}});f.right();
  assert.deepEqual(f.menus[0].cancelIds,['pending']);assert.equal(f.decisions.length,0);
});
test('native label hits take priority even when the text is far above the line price',()=>{
  const line={id:'pending',kind:'entry-trigger',price:2000,orderId:'order-one',label:'Buy Limit'};
  const f=fixture({contextOperationRef:{current:{kind:'marker',line}}});f.right();
  assert.equal(f.menus[0].marker,line);assert.equal(f.menus[0].price,2000);assert.equal(f.decisions.length,0);
});
test('reopening a trading menu on the same candle immediately retriggers its decision card',()=>{
  const f=fixture();f.right();f.right();assert.equal(f.menus.length,2);assert.equal(f.decisions.length,2);
});
test('blank chart space opens trading alone, and unavailable panes or drawing do not start backfill',()=>{
  const blank=fixture({resolveCandleAt:()=>null});blank.right();assert.equal(blank.menus.length,1);assert.deepEqual(blank.decisions,[]);
  for(const override of [{resolvePriceAt:()=>null},{drawingActive:true},{priceSelectionMode:'stop-loss'},{priceSelectionMode:'take-profit'},{priceSelectionMode:'entry-trigger'},{enableCandleContextMenu:false}]){const f=fixture(override);f.right();assert.deepEqual(f.menus,[]);assert.deepEqual(f.decisions,[]);}
});

test('native drawing deletion remains exclusive after cancellation has already ended drawing mode',()=>{
  const f=fixture({drawingActive:true});
  f.runtime.handleContextMouseDown({button:2});
  f.runtime.rememberDrawingContext();
  f.context.drawingActive=false; // Native mousedown already removed the drawing.
  f.right();
  assert.deepEqual(f.menus,[]);assert.deepEqual(f.decisions,[]);assert.equal(f.context.closed,true);
  assert.equal(f.context.contextOperationRef.current,null);
  f.runtime.handleContextMouseDown({button:2});f.right();
  assert.equal(f.menus.length,1);assert.equal(f.decisions.length,1,'the next background gesture works normally');
});

test('each right gesture resets ownership, while a held marker gesture does not expire',()=>{
  const f=fixture();
  const line={id:'sl',kind:'stop-loss',price:1980};
  f.runtime.handleContextMouseDown({button:2});f.runtime.rememberMarkerContext(line);
  const savedNow=Date.now;
  try {Date.now=()=>savedNow()+5000;f.right();} finally {Date.now=savedNow;}
  assert.equal(f.menus[0].marker,line);assert.equal(f.decisions.length,0);
  f.runtime.rememberDrawingContext();
  f.runtime.handleContextMouseDown({button:0});assert.equal(f.context.contextOperationRef.current.kind,'drawing');
  f.runtime.handleContextMouseDown({button:2});f.right();assert.equal(f.menus[1].marker,undefined);
});

test('object right-clicks never fall through to backfill in decision-only charts',()=>{
  const f=fixture({trading:undefined});f.runtime.rememberDrawingContext();f.right();
  f.runtime.rememberMarkerContext({id:'plan-stop',kind:'stop-loss',price:1980,source:'plan'});f.right();
  assert.deepEqual(f.decisions,[]);assert.deepEqual(f.menus,[]);
});

test('restored drawings preserve their native right-click action and claim the gesture before deletion',()=>{
  const f=fixture();let created;
  const chart={createOverlay:value=>{created=value;return value.id;},getOverlays:()=>[]};
  const context={useCallback:fn=>fn,USER_DRAWING_GROUP:'user-drawings',selectedTrainingTextId:'',dataIndexOffsetRef:{current:0},enableTextBoxFreeMovement(){},rememberDrawingContext:f.runtime.rememberDrawingContext};
  const drawingCode=callbacks('../app/components/KLineReplayChart.tsx',['createPersistedDrawing']);
  const {createPersistedDrawing}=new Function('context',`with(context){${drawingCode}}`)(context);
  createPersistedDrawing(chart,{id:'line',name:'segment',points:[],visible:true});
  created.onRightClick({preventDefault(){throw Error('native deletion must remain enabled');}});
  f.right();assert.deepEqual(f.menus,[]);assert.deepEqual(f.decisions,[]);
});
test('the original decision-only path and duplicate-context suppression remain intact',()=>{
  const f=fixture({trading:undefined});f.right();f.right();assert.deepEqual(f.menus,[]);assert.deepEqual(f.decisions,[[f.candle,undefined]]);
});

const queueCode=callbacks('../app/components/TrainingWorkbench.tsx',['queueOpenOrder']);

const submitCode=callbacks('../app/components/TrainingWorkbench.tsx',['submitDecision']);
for (const mode of ['new','edit','backfill']) test(`saving a ${mode} decision clears its form instead of restoring an earlier draft`,()=>{
  const submitted={marketState:'趋势',location:'回调位置',reasons:['顺势'],stop:'90',target:'120',note:'本次计划'};
  const original={id:'saved',barTimestamp:1000,cursor:0,referencePrice:100,submittedAt:'2026-01-01',decision:{...submitted,note:'原记录'}};
  const context={editingDecisionId:mode==='edit'?'saved':'',decisionSubmissions:[original],decision:submitted,
    decisionTarget:mode==='new'?null:{dataIndex:0,timestamp:1000,referencePrice:100},bars:[{timestamp:1000,close:100},{timestamp:2000,close:105}],cursor:1,currentBar:{timestamp:2000,close:105},
    decisionDraftBeforeBackfill:{...submitted,note:'进入编辑前的旧草稿'},backfillAssociation:'none',backfillCandidates:[],trainingComplete:false,
    hasDecisionContent:hasDecisionPlanContent,validateDecisionPlan,updateDecisionRecord,commitDecisionRecord,draftAfterDecisionSaved,createUuid:()=> 'new-plan',
    setDecision:fn=>context.decision=fn(context.decision),setDecisionSubmissions:fn=>context.decisionSubmissions=fn(context.decisionSubmissions),
    setDecisionDraftBeforeBackfill:value=>context.decisionDraftBeforeBackfill=value,setDecisionTarget:value=>context.decisionTarget=value,
    setEditingDecisionId:value=>context.editingDecisionId=value,setSelectedDecisionId(){},setBackfillAssociation(){},setSaveState(){},appendEvent(){},revealNext(){context.advanced=true;}};
  new Function('context',`with(context){${submitCode}}`)(context).submitDecision();
  assert.deepEqual(context.decision,createEmptyDecisionPlan());
  assert.equal(context.decisionSubmissions.find(item=>item.id===(mode==='edit'?'saved':'new-plan')).decision.note,'本次计划');
  assert.equal(Boolean(context.advanced),mode==='new');
  if(mode!=='new')assert.equal(context.decisionDraftBeforeBackfill,null);
});

const finishSaveCode=callbacks('../app/features/mt4/components/Mt4ChartWorkbench.tsx',['finishDecisionSave']);
test('MT4 clears only after the saved record is acknowledged, retaining failures and newer edits',()=>{
  const draft={marketState:'趋势',location:'回调位置',reasons:['顺势'],stopLoss:'90',takeProfit:'120',note:'已提交'};
  const record={id:'one',draft};
  const make=()=>{
    const editor={decisionId:'one',originalDraft:{...draft,note:'旧草稿'}};
    const context={useCallback:fn=>fn,current:{current:{draft,editor}},pendingDecisionSave:{current:{id:'one',record:JSON.stringify(record),draft,editor:JSON.stringify(editor)}},
      decisionValue,mt4Draft,draftAfterDecisionSaved,store:next=>{context.current.current=next;return true;},onPlanProtectionChange(){}};
    return {context,finish:new Function('context',`with(context){${finishSaveCode}}`)(context).finishDecisionSave};
  };
  const failed=make();failed.finish({decisions:[]});assert.equal(failed.context.current.current.draft,draft);
  const saved=make();saved.finish({decisions:[record]});assert.deepEqual(decisionValue(saved.context.current.current.draft),createEmptyDecisionPlan());assert.equal(saved.context.current.current.editor,undefined);
  const newer=make();newer.context.current.current.draft={...draft,note:'保存期间输入的新内容'};newer.finish({decisions:[record]});assert.equal(newer.context.current.current.draft.note,'保存期间输入的新内容');
});

const editCode=callbacks('../app/components/TrainingWorkbench.tsx',['editDecision','selectDecisionForEditing','cancelDecisionBackfill']);
test('selecting a saved plan loads its prices and fields; switching then cancelling restores the original draft',()=>{
  const original={marketState:'趋势',location:'回调位置',stop:'70',target:'150',reasons:['当前理由'],note:'当前草稿'};
  const one={id:'one',barTimestamp:1000,cursor:99,decision:{...original,stop:'90',target:'120',note:'计划一'}};
  const two={id:'two',barTimestamp:2000,cursor:0,decision:{...original,stop:'80',target:'130',note:'计划二'}};
  const context={useCallback:fn=>fn,bars:[{timestamp:1000,close:100},{timestamp:2000,close:110}],cursor:1,
    decision:original,decisionSubmissions:[one,two],decisionDraftBeforeBackfill:null,
    setDecision:value=>context.decision=typeof value==='function'?value(context.decision):value,
    setDecisionDraftBeforeBackfill:value=>context.decisionDraftBeforeBackfill=value,setEditingDecisionId:value=>context.editingId=value,setSelectedDecisionId:value=>context.selectedId=value,
    setDecisionTarget:value=>context.target=value,setProtectionPriceSelection(){},setDrawingRequest(){},setBackfillAssociation(){},setPlaying(){},setSaveState(){},
    requestAnimationFrame(){throw Error('marker selection must preserve viewport');}};
  const runtime=new Function('context',`with(context){${editCode}}`)(context);
  runtime.selectDecisionForEditing('one');
  assert.equal(context.editingId,'one');assert.equal(context.selectedId,'one');assert.equal(context.target.timestamp,1000);
  assert.deepEqual(context.decision,one.decision);assert.notEqual(context.decision.reasons,one.decision.reasons);
  runtime.selectDecisionForEditing('two');assert.deepEqual(context.decision,two.decision);assert.equal(context.target.timestamp,2000);
  runtime.cancelDecisionBackfill();assert.deepEqual(context.decision,original);assert.equal(context.editingId,'');
  assert.equal(context.decisionDraftBeforeBackfill,null);assert.equal(one.decision.note,'计划一');
});

const protectionCode=callbacks('../app/components/TrainingWorkbench.tsx',['applyDraftProtectionPrice']);
test('picking a historical plan protection edits its form without changing orders or generating a new plan',()=>{
  const context={decisionTarget:{timestamp:1000},decision:{stop:'90',target:'120'},protectionPriceText:value=>value.toFixed(2),
    setDecision:fn=>context.decision=fn(context.decision),setProtectionPriceSelection(){},setSaveState(){},
    setOrderStopLoss(){throw Error('changed new order');},setOrderTakeProfit(){throw Error('changed new order');},ensureProtectiveDecisionCard(){throw Error('created another plan');}};
  const {applyDraftProtectionPrice}=new Function('context',`with(context){${protectionCode}}`)(context);
  assert.equal(applyDraftProtectionPrice('stop-loss',88),true);assert.equal(context.decision.stop,'88.00');assert.equal(context.decision.target,'120');
});

const mt4SelectCode=callbacks('../app/features/mt4/components/Mt4ChartWorkbench.tsx',['selectDecisionForEditing']);
test('MT4 marker selection edits the original local plan or opens its saved source, while frozen evidence stays read-only',()=>{
  const record={id:'local',candleTimestamp:1000,referencePrice:100,draft:{stopLoss:'90',takeProfit:'120'}};
  const source={scope:'trade:42',timeframe:5,decisionId:'archive'};
  const edits=[],sources=[],selected=[];
  const context={planViews:[{record:{id:'local'}},{record:{id:'archive'},source}],readOnly:false,current:{current:{decisions:[record]}},
    beginEditor:(...args)=>edits.push(args),onOpenPlanSource:value=>sources.push(value),setSelectedDecisionId:value=>selected.push(value)};
  const runtime=new Function('context',`with(context){${mt4SelectCode}}`)(context);
  runtime.selectDecisionForEditing('local');assert.deepEqual(edits,[[{timestamp:1000,referencePrice:100},record]]);
  runtime.selectDecisionForEditing('archive');assert.deepEqual(sources,[source]);
  context.readOnly=true;runtime.selectDecisionForEditing('local');assert.deepEqual(selected,['local']);assert.equal(edits.length,1);
});
test('trading while backfilling validates the preserved current plan rather than historical edits',()=>{
  const rejections=[];
  const context={orderQty:1,currentBar:{close:100},positionSizeMode:'fixed',liveMode:false,cursor:10,trainingTask:{endCursor:100},bars:Array(101),trainingComplete:false,
    orderType:'market',orderTriggerPrice:'',orderStopLoss:'',orderTakeProfit:'',decision:{stop:'90',target:''},decisionTarget:{timestamp:1},
    currentEntryDecision:{stop:'105',target:''},entryProtectionError,pendingPriceError,executionProfile:{spreadBps:0},instrumentEconomics:undefined,sourceQuotePrice:(_side,price)=>price,rejectOrderAttempt:(...args)=>rejections.push(args)};
  new Function('context',`with(context){${queueCode}}`)(context).queueOpenOrder('buy',{orderType:'limit',triggerPrice:100});
  assert.equal(rejections[0][0].code,'invalid_protective_level');
  assert.equal(rejections[0][1].stopLoss,105);
});
