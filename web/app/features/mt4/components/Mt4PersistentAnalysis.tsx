'use client';

import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Mt4ChartWorkbench } from './Mt4ChartWorkbench';
import { emptyAnalysis, readAnalysis, type Mt4Analysis } from '../mt4Analysis';
import { requestMt4Archive } from '../mt4Gateway';
import type { ArchiveAnalysis, ArchiveContext } from '../mt4ArchiveContracts';

export function downloadArchiveJson(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
type WorkbenchProps = ComponentProps<typeof Mt4ChartWorkbench>;
export function Mt4PersistentAnalysis({ context, seed, onNotice, ...props }: Omit<WorkbenchProps, 'initialAnalysis' | 'onPersist' | 'persistedAnalysis' | 'accountKey'> & { context: ArchiveContext; seed?: Mt4Analysis }) {
  const [loaded, setLoaded] = useState<Mt4Analysis | null>(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [persistedAnalysis, setPersistedAnalysis] = useState<Mt4Analysis | null>(null);
  const revision = useRef(0), pending = useRef<Mt4Analysis | null>(null), current = useRef<Mt4Analysis | null>(null), saving = useRef(false), conflict = useRef(false), mounted = useRef(true), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [identity] = useState(context), [initialSeed] = useState(seed);
  const legacyKey = props.storageKey;
  const outboxKey = `kline.mt4.pending.v1:${legacyKey}:${identity.scope ?? 'chart'}`;
  const flush = useCallback(async () => {
    if (saving.current || !pending.current || conflict.current) return;
    saving.current = true;
    if (mounted.current) onNotice?.('正在保存标记');
    try {
      while (pending.current && !conflict.current) {
        const data: Mt4Analysis = pending.current; pending.current = null;
        try {
          const result = await requestMt4Archive<ArchiveAnalysis>({}, { action: 'save-analysis', ...identity, revision: revision.current, data }, AbortSignal.timeout(15000));
          revision.current = result.revision;
          try {
            if (pending.current) localStorage.setItem(outboxKey, JSON.stringify({ revision: revision.current, data: pending.current }));
            else localStorage.removeItem(outboxKey);
          } catch { /* The server acknowledgement is authoritative. */ }
          if (mounted.current) { setPersistedAnalysis(data); setError(''); onNotice?.('标记已保存'); }
        } catch (e) {
          pending.current ??= data; conflict.current = true;
          if (mounted.current) { setError(e instanceof Error ? e.message : '标记未保存，请保留当前内容并重试'); }
        }
      }
    } finally { saving.current = false; }
  }, [identity, onNotice, outboxKey]);
  const persist = useCallback((next: Mt4Analysis) => {
    current.current = next; pending.current = structuredClone(next);
    try { localStorage.setItem(outboxKey, JSON.stringify({ revision: revision.current, data: next })); } catch { /* The unload guard retains pending edits. */ }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 400);
  }, [flush, outboxKey]);
  useEffect(() => {
    mounted.current = true; let disposed = false;
    const controller = new AbortController();
    if (props.readOnly) return () => { mounted.current = false; };
    void (async () => {
      try {
        let result = await requestMt4Archive<ArchiveAnalysis>({ action: 'analysis', ...identity }, undefined, controller.signal);
        if (!result.revision) {
          // Keep the browser original. Never replace an established archive with an old cache.
          const legacy = identity.scope && identity.scope !== 'chart' ? null : localStorage.getItem(legacyKey);
          const data = legacy ? readAnalysis(legacy) : initialSeed;
          if (data) result = await requestMt4Archive<ArchiveAnalysis>({}, { action: 'save-analysis', ...identity, revision: 0, data, migrate: true }, controller.signal);
        }
        if (disposed) return;
        revision.current = result.revision; conflict.current = false; pending.current = null;
        current.current = result.data ? readAnalysis(JSON.stringify(result.data)) : emptyAnalysis();
        setLoaded(current.current); setError('');
        const outboxRaw = localStorage.getItem(outboxKey);
        if (outboxRaw) {
          const outbox = JSON.parse(outboxRaw) as { revision: number; data: Mt4Analysis };
          const recovered = readAnalysis(JSON.stringify(outbox.data));
          if (JSON.stringify(recovered) === JSON.stringify(current.current)) localStorage.removeItem(outboxKey);
          else {
            current.current = recovered; pending.current = recovered; setLoaded(recovered);
            if (outbox.revision !== revision.current) { conflict.current = true; setError('发现未完成保存的编辑，与档案版本不同。请先导出当前内容，再重新读取档案。'); }
            else void flush();
          }
        }
      } catch (e) { if (!disposed) { setError(e instanceof Error ? e.message : '标记未能读取，请重试');  } }
    })();
    return () => { disposed = true; mounted.current = false; controller.abort(); if (timer.current) clearTimeout(timer.current); void flush(); };
  }, [reload, flush, identity, initialSeed, legacyKey, outboxKey, props.readOnly]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (pending.current || saving.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, []);
  if (props.readOnly) return <Mt4ChartWorkbench accountKey={identity.accountKey} {...props} onNotice={onNotice} initialAnalysis={initialSeed ?? emptyAnalysis()} onPersist={() => {}} />;
  return <>
    {error && <div className="mt4-archive-save" role="status"><span className="down" role="alert">{error}</span><button className="ghost-button" onClick={() => { conflict.current = false; if (loaded) void flush(); else setReload(n => n + 1); }}>重试</button><button className="ghost-button" onClick={() => downloadArchiveJson(current.current ?? localStorage.getItem(legacyKey) ?? '{}', 'MT4-绘图与决策.json')}>导出当前内容</button><button className="ghost-button" onClick={() => { if (window.confirm('重新读取会放弃本页未保存的编辑，请先导出当前内容。继续吗？')) { pending.current = null; localStorage.removeItem(outboxKey); setLoaded(null); setReload(n => n + 1); } }}>重新读取</button></div>}
    {loaded && <Mt4ChartWorkbench accountKey={identity.accountKey} {...props} initialAnalysis={loaded} persistedAnalysis={persistedAnalysis} onPersist={persist} />}
  </>;
}
