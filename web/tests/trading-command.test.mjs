import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  TRADING_COMMAND_VERSION,
  TradingCommandError,
  createOpenOrderFromTradingCommand,
  normalizeTradingCommand,
} from "../app/lib/tradingCommands.ts";

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
