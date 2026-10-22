/** Prepare one protection change against the latest acknowledged account/order. */
export function prepareMt4Protection({ state, edit, values, remove, id }) {
  if (!state || state.accountKey !== edit.accountKey) throw new Error('账户已变化，请重新打开订单后修改。');
  if (state.connection !== 'connected' || !state.snapshot?.account.connected || !state.enabled) throw new Error('请先连接并开启 MT4 交易，再修改保护价。');
  if (!state.snapshot.account.tradeAllowed) throw new Error('MT4 交易权限已关闭，请恢复权限后重试。');
  if (state.unresolved) throw new Error('已有未完成的指令，请先等待或核对结果。');
  const order = state.snapshot.orders.find(order => order.ticket === edit.order.ticket && order.symbol === edit.order.symbol);
  if (!order || order.closeTime > 0 || order.type !== edit.order.type || order.openTime !== edit.order.openTime) throw new Error('订单已变化或已不在持仓，请重新读取后修改。');
  const fields = remove ? [remove] : edit.field === 'both' ? ['stopLoss', 'takeProfit'] : [edit.field];
  if (fields.some(field => !['stopLoss', 'takeProfit'].includes(field))) throw new Error('请选择要修改的止损或止盈。');
  const next = { stopLoss: order.stopLoss, takeProfit: order.takeProfit };
  for (const field of fields) {
    if (order[field] !== edit.order[field]) throw new Error('保护价已在 MT4 更新，请重新打开订单后修改。');
    const value = remove ? 0 : Number(values[field].trim());
    if (!Number.isFinite(value) || value < 0) throw new Error('请填写有效的保护价格，或使用取消按钮移除保护。');
    next[field] = value;
  }
  if (next.stopLoss === order.stopLoss && next.takeProfit === order.takeProfit) return null;
  return { id, accountKey: edit.accountKey, type: 'protect', symbol: order.symbol, ticket: order.ticket, ...next };
}
