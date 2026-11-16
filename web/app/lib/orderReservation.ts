import { estimatedBuyCashRequired, executionFee, executionPrice, executionPriceFromQuote, type ExecutionCostProfile, type OrderType } from "./executionEngine.ts";
import { isMarginEconomics, requiredMargin, type InstrumentEconomics } from "./fxTrading.ts";

export function calculateOrderReservation(side: "buy" | "sell", type: OrderType, price: number, qty: number, profile: Partial<ExecutionCostProfile>, economics?: InstrumentEconomics) {
  const marginMode = isMarginEconomics(economics);
  const execution = marginMode && type !== "market" ? executionPriceFromQuote(side, price, profile) : executionPrice(side, price, profile, economics);
  const fee = executionFee(execution, qty, profile, economics);
  const margin = requiredMargin(execution, qty, economics);
  return { entryFee: fee, requiredOrderMargin: margin,
    reservedMargin: marginMode ? Number(margin) + fee : 0,
    reservedCash: !marginMode && side === "buy" ? estimatedBuyCashRequired(price, qty, profile, economics) : 0 };
}
