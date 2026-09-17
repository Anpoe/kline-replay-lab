"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { dataMarkets, type DataMarket } from "../marketDataContracts";

export function MarketDataClearPanel({ market, onClear, onRebuild }: {
  market: DataMarket;
  onClear: () => Promise<void>;
  onRebuild?: () => void;
}) {
  const label = dataMarkets.find((item) => item.id === market)!.label;
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<"idle" | "clearing" | "completed" | "failed">("idle");
  const [error, setError] = useState("");
  const pending = useRef(false);

  const clear = async () => {
    if (pending.current) return;
    pending.current = true;
    setState("clearing");
    setError("");
    try {
      await onClear();
      setState("completed");
      setConfirming(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "行情清空未完成，请重试。");
      setState("failed");
    } finally {
      pending.current = false;
    }
  };

  return (
    <section className="market-clear-card" aria-label={`${label}行情清空`} aria-busy={state === "clearing"}>
      <div>
        <strong>清空{label}行情</strong>
        <p>清除本市场所有品种、周期和来源的行情及下载任务，用于重新建立训练数据。</p>
        <p>训练记录、复盘快照、设置及其他市场数据保留。</p>
        {confirming && <p className="market-clear-warning">确定清空{label}的全部行情？{market === "CN" && "本机保存的各数据源行情、权息信息和原始数据备份也会删除。"}此操作无法撤销，之后需重新初始化或导入行情。</p>}
        {state === "clearing" && <p role="status">正在清空{label}行情，请等待完成。</p>}
        {state === "completed" && <p role="status">{label}行情已清空，可重新初始化或导入行情。已有训练快照继续保留。</p>}
        {state === "failed" && <p role="alert" className="market-clear-warning">{error}</p>}
      </div>
      <div className="market-maintenance-actions">
        {confirming ? <>
          <button type="button" className="danger" disabled={state === "clearing"} onClick={() => void clear()}>
            <Trash2 size={14} />{state === "clearing" ? "正在清空…" : state === "failed" ? `重试清空${label}行情` : `确认清空${label}行情`}
          </button>
          <button type="button" disabled={state === "clearing"} onClick={() => { setConfirming(false); setState("idle"); setError(""); }}>取消</button>
        </> : <>
          <button type="button" className="danger" onClick={() => { setConfirming(true); setState("idle"); }}> <Trash2 size={14} />清空{label}行情</button>
          {state === "completed" && onRebuild && <button type="button" onClick={onRebuild}>重新建立{label}数据</button>}
        </>}
      </div>
    </section>
  );
}
