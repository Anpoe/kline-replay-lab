export function riskSizedMt4Lots({ balance, riskPercent, entryPrice, stopLoss, symbol }) {
  if (!(balance > 0) || !(riskPercent > 0 && riskPercent <= 100) || !(entryPrice > 0) || !(stopLoss > 0)) throw new Error("按止损风险下单需要有效余额、风险比例和止损价格");
  const { tickValue, tickSize, minLot, maxLot, lotStep } = symbol;
  const distance = Math.abs(entryPrice - stopLoss);
  if (!(distance > 0 && tickValue > 0 && tickSize > 0 && lotStep > 0 && minLot > 0)) throw new Error("该品种缺少有效跳动价值或止损距离，暂不能计算风险手数");
  const riskBudget = balance * riskPercent / 100, lossPerLot = distance / tickSize * tickValue;
  const lots = Number((Math.floor((Math.min(maxLot, riskBudget / lossPerLot) + 1e-10) / lotStep) * lotStep).toFixed(8));
  if (lots < minLot) throw new Error("风险预算低于最小手数对应的止损风险，请调整风险比例或止损");
  return { lots, riskBudget, estimatedRisk: lots * lossPerLot };
}
export function checkMt4OpeningGap({ previousClose, openingPrice, mode, unit, threshold }) {
  if (mode === "off") return;
  if (!["high", "low"].includes(mode) || !["percent", "price"].includes(unit) || !(threshold > 0) || !(previousClose > 0) || !(openingPrice > 0)) throw new Error("跳空过滤需要有效的上一根收盘价、当前开盘价和阈值");
  const distance = unit === "price" ? threshold : previousClose * threshold / 100;
  const blocked = mode === "high" ? openingPrice < previousClose || openingPrice >= previousClose + distance : openingPrice > previousClose || openingPrice <= previousClose - distance;
  if (blocked) throw new Error("当前 K 线开盘跳空不符合所选买入条件，请调整过滤或等待下一根");
}
