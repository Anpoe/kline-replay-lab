import test from 'node:test';
import assert from 'node:assert/strict';
import { modifyPendingOrderFromTradingCommand, normalizeTradingCommand } from '../app/lib/tradingCommands.ts';
import { entryProtectionError, pendingPriceError } from '../app/lib/orderPriceValidation.ts';

const order={id:'one',action:'open',side:'buy',orderType:'limit',triggerPrice:99,stopLoss:95,takeProfit:110,qty:.03,filledQty:.02,originalQty:.05,reservedMargin:100,positionId:'p',decisionSubmissionId:'decision',createdAt:10};
const command=normalizeTradingCommand({commandId:'change',type:'modify-order',environment:'training',accountId:'training:one',market:'GOLD',instrumentId:'XAUUSD.GOLD',timestamp:20,observedAccountVersion:1,orderId:'one',triggerPrice:98,expectedTriggerPrice:99});

test('pending price changes preserve identity, partial fills, quantity and all other conditions',()=>{
  const changed=modifyPendingOrderFromTradingCommand([order],command,100,.01);
  assert.deepEqual(changed,[{...order,triggerPrice:98}]);assert.equal(order.triggerPrice,99);
});
test('pending price edits reject stale, filled, cancelled, crossed protection and invalid tick prices',()=>{
  for(const [orders,patch] of [[[],{}],[[{...order,orderType:'market'}],{}],[[order],{expectedTriggerPrice:98}],[[order],{triggerPrice:94}],[[order],{triggerPrice:101}],[[order],{triggerPrice:98.005}]]){
    assert.throws(()=>modifyPendingOrderFromTradingCommand(orders,{...command,...patch},100,.01));
  }
});
test('all four pending types retain strict quote direction and protective entry constraints',()=>{
  for(const [side,type,valid,bad] of [['buy','limit',99,101],['buy','stop',101,99],['sell','limit',101,99],['sell','stop',99,101]]){
    assert.equal(pendingPriceError(side,type,valid,100),'');assert.ok(pendingPriceError(side,type,bad,100));assert.ok(pendingPriceError(side,type,100,100));
  }
  assert.ok(entryProtectionError('buy',100,101,110));assert.ok(entryProtectionError('sell',100,110,101));assert.equal(entryProtectionError('buy',100,90,110),'');
});
