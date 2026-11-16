export function entryProtectionError(side: "buy" | "sell", price: number, stopLoss?: number | null, takeProfit?: number | null) {
  const badStop = stopLoss != null && stopLoss > 0 && (side === "buy" ? stopLoss >= price : stopLoss <= price);
  const badTarget = takeProfit != null && takeProfit > 0 && (side === "buy" ? takeProfit <= price : takeProfit >= price);
  return badStop || badTarget ? side === "buy" ? "多头止损应低于预计入场价，止盈应高于预计入场价" : "空头止损应高于预计入场价，止盈应低于预计入场价" : "";
}

export function pendingPriceError(side: "buy" | "sell", orderType: "limit" | "stop", price: number, reference: number) {
  if (!Number.isFinite(price) || price <= 0) return "请重新选择大于零的挂单价格";
  if (!Number.isFinite(reference) || reference <= 0) return "报价尚未就绪，请重新读取后重试";
  const valid = side === "buy" ? orderType === "limit" ? price < reference : price > reference : orderType === "limit" ? price > reference : price < reference;
  return valid ? "" : "挂单价格不符合所选买卖方向及限价或突破类型，请重新选择";
}
