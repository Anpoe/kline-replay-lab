// One bounded stream per adapter context. Pages are bounded;
// already loaded candles are retained as the user browses in either direction.
export function mergeCandles(previous, incoming) {
  if (!incoming.length) return previous;
  const byTime = new Map(previous.map(bar => [bar.timestamp, bar]));
  let changed = false;
  for (const bar of incoming) {
    if (JSON.stringify(byTime.get(bar.timestamp)) !== JSON.stringify(bar)) { byTime.set(bar.timestamp, bar); changed = true; }
  }
  return changed ? [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp) : previous;
}

export function createCandleHistory({ load, onChange, keyOf, validate = () => {}, loadInitial = true }) {
  let state = { bars: [], loading: false, error: '', hasBefore: true, hasAfter: false };
  let context = null, identity = '', controller = null, generation = 0, failed = null, tail = [];
  const publish = changes => { state = { ...state, ...changes }; onChange(state); };
  const read = async query => {
    if (!context || state.loading) return;
    const version = generation, requestContext = context;
    controller = new AbortController();
    const signal = controller.signal;
    publish({ loading: true, error: '' }); failed = null;
    try {
      const page = await load({ ...requestContext, ...query }, signal);
      if (signal.aborted || version !== generation) return;
      validate(page, requestContext);
      let bars = mergeCandles(state.bars, page.bars);
      // Never overwrite the displayed (possibly frozen) live tail with a DB quote.
      if (context.live) bars = mergeCandles(bars, tail);
      publish({ bars, digits: page.digits, loading: false,
        hasBefore: query.after ? state.hasBefore : page.hasBefore === true,
        hasAfter: context.live ? false : query.before ? state.hasAfter : page.hasAfter === true });
    } catch (error) {
      if (signal.aborted || version !== generation) return;
      failed = query;
      publish({ loading: false, error: error instanceof Error ? error.message : '历史行情读取失败，请重试。' });
    }
  };
  return {
    getState: () => state,
    setContext(next, seed = [], focus = 0) {
      const key = next ? keyOf(next, focus) : '';
      if (key === identity) return;
      generation++; controller?.abort(); identity = key; context = next; tail = seed; failed = null;
      publish({ identity, bars: seed, digits: undefined, loading: false, error: '', hasBefore: true, hasAfter: !next?.live });
      if (next && loadInitial) void read(focus ? { focus } : seed.length ? { before: seed[0].timestamp } : {});
    },
    update(seed) {
      tail = seed;
      const bars = mergeCandles(state.bars, seed);
      if (bars !== state.bars) publish({ bars,
        hasBefore: state.hasBefore || !state.bars.length || bars[0].timestamp < state.bars[0].timestamp,
        hasAfter: !context?.live && (state.hasAfter || !state.bars.length || bars.at(-1).timestamp > state.bars.at(-1).timestamp),
      });
    },
    extend(direction) {
      if (state.error || !state.bars.length || (direction === 'before' ? !state.hasBefore : !state.hasAfter)) return;
      return read(direction === 'before' ? { before: state.bars[0].timestamp } : { after: state.bars.at(-1).timestamp });
    },
    retry() { if (failed) return read(failed); },
    dispose() { generation++; controller?.abort(); context = null; identity = ''; },
  };
}
