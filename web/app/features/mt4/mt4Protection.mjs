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

/** Project acknowledged orders and pending protection changes onto the live chart. */
export function deriveMt4OrderProtectionLines({ state, symbol, timestamp, digits, movable, pending }) {
  if (!state?.snapshot || !state.accountKey || !(timestamp > 0)) return [];
  return state.snapshot.orders.filter(order => order.symbol === symbol && order.closeTime === 0 && order.type >= 0 && order.type <= 5 && order.openPrice > 0).flatMap(order => {
    const buy = [0, 2, 4].includes(order.type);
    const waiting = pending?.type === 'protect' && pending.accountKey === state.accountKey && pending.symbol === symbol && pending.ticket === order.ticket && (!pending.status || ['queued', 'sent'].includes(pending.status));
    return ['entry', 'stopLoss', 'takeProfit'].flatMap(field => {
      const current = field === 'entry' ? order.openPrice : order[field];
      const changed = waiting && field !== 'entry' && pending[field] != null && pending[field] !== current;
      const price = changed ? pending[field] : current;
      if (!(price > 0) || !Number.isFinite(price)) return [];
      const label = field === 'entry' ? (order.type <= 1 ? buy ? '买入' : '卖出' : buy ? '买入挂单' : '卖出挂单') : field === 'stopLoss' ? '止损' : '止盈';
      return [{ id: `mt4-position:${state.accountKey}:${encodeURIComponent(symbol)}:${order.ticket}:${order.openTime}:${order.type}:${order.openPrice}:${field}`,
        accountKey: state.accountKey, order: { ...order }, field,
        kind: field === 'entry' ? 'entry-trigger' : field === 'stopLoss' ? 'stop-loss' : 'take-profit',
        price, timestamp, label: `#${order.ticket} ${label} · ${price.toFixed(digits)}${changed ? ' · 等待确认' : ''}`,
        hint: waiting ? '等待 MT4 确认后可继续修改' : movable ? field === 'entry' ? '拖动设置止损或止盈，松手提交到 MT4' : `拖动修改${label}，松手提交到 MT4` : '当前不可拖动，请核对连接与交易状态',
        source: 'position', positionId: String(order.ticket), side: buy ? 'long' : 'short', movable: movable && !waiting }];
    });
  });
}

/** A chart drag changes protection only. The order entry price is never modified. */
export function prepareMt4ProtectionDrag({ state, line, price, id }) {
  if (!line.movable) throw new Error('当前订单暂不可拖动，请先等待处理完成并开启交易。');
  if (!state || state.accountKey !== line.accountKey) throw new Error('账户已变化，请重新读取订单后修改。');
  if (state.selection.symbol !== line.order.symbol || state.snapshot?.chart.symbol !== line.order.symbol) throw new Error('图表品种已变化，请重新读取订单后修改。');
  if (!Number.isFinite(price) || price <= 0) throw new Error('保护价格需大于 0，请重新拖动。');
  const symbol = state.snapshot.symbols.find(symbol => symbol.symbol === line.order.symbol);
  if (!symbol) throw new Error('品种报价尚未就绪，请重新读取 MT4 后修改。');
  price = Number(price.toFixed(symbol.digits));
  if (!(price > 0)) throw new Error('保护价格需大于 0，请重新拖动。');
  let field = line.field;
  if (field === 'entry') {
    const current = state.snapshot.orders.find(order => order.ticket === line.order.ticket && order.symbol === line.order.symbol);
    if (!current || current.openPrice !== line.order.openPrice) throw new Error('订单开仓价已变化，请重新读取后拖动。');
    if (price === line.order.openPrice) return null;
    const buy = [0, 2, 4].includes(line.order.type);
    if (line.order.type <= 1 && (!(symbol.bid > 0 && symbol.ask > 0 && symbol.quoteTime > 0) || state.snapshot.capturedAt - symbol.quoteTime > 30)) throw new Error('报价已过期，请重新读取 MT4 后拖动保护价。');
    const reference = line.order.type <= 1 ? buy ? symbol.bid : symbol.ask : line.order.openPrice;
    field = (buy ? price < reference : price > reference) ? 'stopLoss' : 'takeProfit';
  }
  return prepareMt4Protection({ state, edit: { accountKey: line.accountKey, order: line.order, field },
    values: { stopLoss: field === 'stopLoss' ? String(price) : String(line.order.stopLoss), takeProfit: field === 'takeProfit' ? String(price) : String(line.order.takeProfit) }, id });
}
