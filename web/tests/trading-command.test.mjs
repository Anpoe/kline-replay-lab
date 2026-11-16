import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  TRADING_COMMAND_VERSION,
  TradingCommandError,
  createOpenOrderFromTradingCommand,
  normalizeTradingCommand,
  modifyProtectionFromTradingCommand,
} from "../app/lib/tradingCommands.ts";

test('removing one protection targets either a position or a pending order and preserves the opposite side and order reservations', () => {
  const position={id:'p',status:'open',stopLoss:90,takeProfit:120,qty:2};
  const order={id:'o',action:'open',stopLoss:90,takeProfit:120,qty:1,filledQty:1,reservedCash:100,triggerPrice:100};
  const base={type:'modify-protection',stopLoss:null,takeProfit:120};
  assert.deepEqual(modifyProtectionFromTradingCommand([position],{...base,positionId:'p'}),[{...position,stopLoss:undefined}]);
  assert.deepEqual(modifyProtectionFromTradingCommand([order],{...base,orderId:'o'},'order'),[{...order,stopLoss:undefined}]);
  assert.deepEqual(modifyProtectionFromTradingCommand([order],{...base,orderId:'o',stopLoss:90,takeProfit:null},'order'),[{...order,takeProfit:undefined}]);
  assert.equal(order.stopLoss,90);assert.equal(position.stopLoss,90);
  assert.throws(()=>modifyProtectionFromTradingCommand([],{...base,orderId:'o'},'order'),/不存在或已经成交/);
  assert.throws(()=>modifyProtectionFromTradingCommand([{...order,action:'close'}],{...base,orderId:'o'},'order'),/不存在/);
  assert.throws(()=>modifyProtectionFromTradingCommand([order],{...base,positionId:'o'},'order'),/缺少委托编号/);
});

test("normalizes a versioned live trading command without changing its identity", () => {
  const command = normalizeTradingCommand({
    commandId: "cmd-1",
    type: "submit-order",
    environment: "live",
    accountId: "live-account-CN",
    market: "CN",
    instrumentId: "600519.SH",
    timestamp: 10,
    observedAccountVersion: 3,
    side: "buy",
    qty: 100,
    orderType: "limit",
    triggerPrice: 1_000,
    stopLoss: null,
  });

  assert.equal(command.version, TRADING_COMMAND_VERSION);
  assert.equal(command.commandId, "cmd-1");
  assert.equal(command.qty, 100);
  assert.equal(command.triggerPrice, 1_000);
  assert.equal(command.stopLoss, null);
});

test("pending protection edits validate against entry while filled positions can trail into profit", () => {
  const order = { id: "o", action: "open", side: "buy", triggerPrice: 100, stopLoss: 90, takeProfit: 120 };
  const command = { type: "modify-protection", orderId: "o", stopLoss: 101, takeProfit: 120 };
  assert.throws(() => modifyProtectionFromTradingCommand([order], command, "order"), /止损/);
  assert.throws(() => modifyProtectionFromTradingCommand([{ ...order, side: "sell" }], { ...command, stopLoss: 110, takeProfit: 101 }, "order"), /止盈/);
  const position = { id: "p", status: "open", side: "long", entryPrice: 100, stopLoss: 90, takeProfit: 120 };
  assert.equal(modifyProtectionFromTradingCommand([position], { ...command, positionId: "p" })[0].stopLoss, 101);
});

test("rejects commands that do not carry an account version", () => {
  assert.throws(
    () => normalizeTradingCommand({
      commandId: "cmd-1",
      type: "cancel-order",
      environment: "live",
      accountId: "live-account-CN",
      market: "CN",
      instrumentId: "600519.SH",
      timestamp: 10,
      orderId: "order-1",
    }),
    (error) => error instanceof TradingCommandError && error.code === "invalid_command",
  );
});

test("freezes the opening-gap reference price on a submitted order", () => {
  const command = normalizeTradingCommand({
    commandId: "cmd-gap",
    type: "submit-order",
    environment: "training",
    accountId: "training:session-1",
    market: "CN",
    instrumentId: "600519.SH",
    timestamp: 10,
    observedAccountVersion: 0,
    side: "buy",
    qty: 100,
    openingGapMode: "high",
    openingGapUnit: "percent",
    openingGapThreshold: 0.125,
    openingGapReferencePrice: 99.875,
  });

  assert.equal(createOpenOrderFromTradingCommand(command).openingGapReferencePrice, 99.875);
});

test("the command boundary has a server route and an idempotency receipt", async () => {
  const [route, service, gateway] = await Promise.all([
    readFile(new URL("../app/api/trading-command/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/live-command.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/features/live/liveGateway.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /applyLiveTradingCommand/);
  assert.match(service, /live_command_receipts/);
  assert.match(service, /ON CONFLICT\(command_id\) DO NOTHING/);
  assert.match(gateway, /\/api\/trading-command/);
});
