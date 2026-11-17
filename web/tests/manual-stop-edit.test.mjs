import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { normalizeTradingCommand, modifyProtectionFromTradingCommand } from '../app/lib/tradingCommands.ts';
import { entryProtectionError } from '../app/lib/orderPriceValidation.ts';

const source=readFileSync(new URL('../app/components/TrainingWorkbench.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('workbench.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let expression;
const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='moveProtectionLine')expression=node.initializer.getText(ast);ts.forEachChild(node,visit);};visit(ast);
const compiled=ts.transpileModule(`return (${expression});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

function fixture(side='long', live=false) {
  const position={id:'position',status:'open',side,stopLoss:side==='long'?90:110,takeProfit:side==='long'?120:80,qty:1,initialRisk:10};
  const commands=[],events=[];
  const context={currentBar:{timestamp:1000,close:100},liveMode:live,trainingComplete:false,protectionCommandLock:{current:false},
    pendingOrders:[],openPositions:[position],positions:[position],protectionPriceText:price=>price.toFixed(2),
    createUuid:()=> 'manual-stop-command',sessionId:'test',instrument:{id:'EURUSD.FX',market:'FX'},marketRules:{market:'FX',id:'fx',version:'1'},
    eventSequenceRef:{current:0},tradingCommandMarketFor:()=> 'FX',normalizeTradingCommand,modifyProtectionFromTradingCommand,entryProtectionError,
    livePortfoliosRef:{current:[{instrumentId:'EURUSD.FX',accountId:'account'}]},liveAccountsRef:{current:[{id:'account',version:1}]},appSettingsRef:{current:{}},
    liveGateway:{postCommand:command=>{commands.push(command);return new Promise(()=>{});}},setProtectionCommandRunning(){},
    setPositions:value=>context.positions=value,setPendingOrders:value=>context.pendingOrders=value,setRuleNotice:value=>context.notice=value,setSaveState:value=>context.saved=value,
    appendEvent:(...args)=>events.push(args)};
  return {context,position,commands,events,move:new Function('context',`with(context){${compiled}}`)(context),line:{kind:'stop-loss',source:'position',positionId:position.id}};
}

for (const [side,price] of [['long',85],['long',95],['short',115],['short',105]]) {
  test(`manual ${side} stop can move to ${price} while retaining the other protection and original risk`,()=>{
    const f=fixture(side);assert.equal(f.move(f.line,price),true);
    assert.equal(f.context.positions[0].stopLoss,price);assert.equal(f.context.positions[0].takeProfit,f.position.takeProfit);
    assert.equal(f.context.positions[0].initialRisk,10);assert.equal(f.position.stopLoss,side==='long'?90:110);
    assert.equal(f.context.notice,'');assert.equal(f.events.length,1);
  });
}

for(const [side,price,message] of [['long',100,'多头止损必须低于当前价'],['long',105,'多头止损必须低于当前价'],['short',100,'空头止损必须高于当前价'],['short',95,'空头止损必须高于当前价']]) {
  test(`invalid ${side} stop at ${price} is refused with a precise reason and no position change`,()=>{
    const f=fixture(side);assert.equal(f.move(f.line,price),false);assert.equal(f.context.notice,message);
    assert.equal(f.context.positions[0],f.position);assert.equal(f.events.length,0);
  });
}

test('manual removal and re-adding a stop preserve take profit',()=>{
  const f=fixture();assert.equal(f.move(f.line,null),true);assert.equal(f.context.positions[0].stopLoss,undefined);assert.equal(f.context.positions[0].takeProfit,120);
});

test('live simulation submits a widened stop through its existing command without changing local confirmed positions',()=>{
  const f=fixture('long',true);assert.equal(f.move(f.line,85),true);
  assert.equal(f.commands.length,1);assert.equal(f.commands[0].type,'modify-protection');assert.equal(f.commands[0].stopLoss,85);
  assert.equal(f.commands[0].takeProfit,120);assert.equal(f.context.positions[0],f.position);
});
