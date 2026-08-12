import {
  estimatedBuyCashRequired,
  executionFee,
  executionPrice,
  executionPriceFromQuote,
  type ExecutionCostProfile,
} from "./executionEngine.ts";
import {
  accountPnl,
  isMarginEconomics,
  requiredMargin,
  type InstrumentEconomics,
} from "./fxTrading.ts";

export type RiskSizingInput = {
  side: "buy" | "sell";
  equity: number;
  riskPercent: number;
  entryRawPrice: number;
  entryPriceBasis?: "source" | "quote";
  stopLoss: number;
  minimumQuantity: number;
  quantityStep: number;
  availableCash?: number;
  availableMargin?: number;
  profile?: Partial<ExecutionCostProfile>;
  instrumentEconomics?: InstrumentEconomics;
};

export type RiskSizingResult = {
  quantity: number;
  riskBudget: number;
  estimatedRisk: number;
  entryPrice: number;
  stopExecutionPrice: number;
  limitedByCash: boolean;
  limitedByMargin: boolean;
};

function highestAlignedQuantity(
  maximum: number,
  minimum: number,
  step: number,
  predicate: (quantity: number) => boolean,
) {
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
  const precision = Math.max(0, String(safeStep).split(".")[1]?.length ?? 0);
  const safeMinimum = Math.max(safeStep, Math.ceil((minimum - 1e-12) / safeStep) * safeStep);
  const maxSteps = Math.floor(Math.max(0, maximum) / safeStep);
  const minSteps = Math.ceil(safeMinimum / safeStep);
  if (maxSteps < minSteps) return 0;
  let low = minSteps;
  let high = maxSteps;
  let accepted = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const quantity = Number((middle * safeStep).toFixed(precision));
    if (predicate(quantity)) {
      accepted = quantity;
      low = middle + 1;
    } else high = middle - 1;
  }
  return accepted;
}

export function inferRiskSizingSide(
  entryRawPrice: number,
  stopLoss: number,
): "buy" | "sell" | null {
  const entry = Number(entryRawPrice);
  const stop = Number(stopLoss);
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || entry <= 0 || stop <= 0 || entry === stop) {
    return null;
  }
  return stop < entry ? "buy" : "sell";
}

export function calculateRiskSizedQuantity(input: RiskSizingInput): RiskSizingResult | null {
  const equity = Number(input.equity);
  const riskPercent = Number(input.riskPercent);
  const entryRawPrice = Number(input.entryRawPrice);
  const stopLoss = Number(input.stopLoss);
  if (![equity, riskPercent, entryRawPrice, stopLoss].every(Number.isFinite)) return null;
  if (equity <= 0 || riskPercent <= 0 || entryRawPrice <= 0 || stopLoss <= 0) return null;
  if (input.side === "buy" ? stopLoss >= entryRawPrice : stopLoss <= entryRawPrice) return null;

  const economics = input.instrumentEconomics;
  const usesBidQuotes = economics?.quoteBasis === "bid";
  const entryPrice = usesBidQuotes && input.entryPriceBasis === "quote"
    ? executionPriceFromQuote(input.side, entryRawPrice, input.profile)
    : executionPrice(input.side, entryRawPrice, input.profile, economics);
  const exitSide = input.side === "buy" ? "sell" : "buy";
  const stopExecutionPrice = usesBidQuotes
    ? executionPriceFromQuote(exitSide, stopLoss, input.profile)
    : executionPrice(exitSide, stopLoss, input.profile, economics);
  const positionSide = input.side === "buy" ? "long" : "short";
  const priceRiskPerQuantity = Math.abs(accountPnl(
    entryPrice,
    stopExecutionPrice,
    1,
    positionSide,
    economics,
  ) ?? 0);
  if (priceRiskPerQuantity <= 0) return null;
  const riskBudget = equity * Math.min(100, riskPercent) / 100;
  const roughMaximum = riskBudget / priceRiskPerQuantity;
  const riskAt = (quantity: number) => (
    priceRiskPerQuantity * quantity
    + executionFee(entryPrice, quantity, input.profile, economics)
    + executionFee(stopExecutionPrice, quantity, input.profile, economics)
  );
  const riskLimitedQuantity = highestAlignedQuantity(
    roughMaximum,
    input.minimumQuantity,
    input.quantityStep,
    (quantity) => riskAt(quantity) <= riskBudget + 0.000001,
  );
  if (riskLimitedQuantity <= 0) return {
    quantity: 0,
    riskBudget,
    estimatedRisk: 0,
    entryPrice,
    stopExecutionPrice,
    limitedByCash: false,
    limitedByMargin: false,
  };

  let quantity = riskLimitedQuantity;
  let limitedByCash = false;
  if (input.side === "buy" && Number.isFinite(Number(input.availableCash))) {
    const availableCash = Math.max(0, Number(input.availableCash));
    const cashLimitedQuantity = highestAlignedQuantity(
      quantity,
      input.minimumQuantity,
      input.quantityStep,
      (candidate) => estimatedBuyCashRequired(entryRawPrice, candidate, input.profile, economics) <= availableCash + 0.000001,
    );
    limitedByCash = cashLimitedQuantity < quantity;
    quantity = cashLimitedQuantity;
  }
  let limitedByMargin = false;
  if (isMarginEconomics(economics) && Number.isFinite(Number(input.availableMargin))) {
    const availableMargin = Math.max(0, Number(input.availableMargin));
    const marginLimitedQuantity = highestAlignedQuantity(
      quantity,
      input.minimumQuantity,
      input.quantityStep,
      (candidate) => {
        const margin = requiredMargin(entryPrice, candidate, economics);
        const fee = executionFee(entryPrice, candidate, input.profile, economics);
        return margin != null && margin + fee <= availableMargin + 0.000001;
      },
    );
    limitedByMargin = marginLimitedQuantity < quantity;
    quantity = marginLimitedQuantity;
  }
  return {
    quantity,
    riskBudget,
    estimatedRisk: quantity > 0 ? riskAt(quantity) : 0,
    entryPrice,
    stopExecutionPrice,
    limitedByCash,
    limitedByMargin,
  };
}
