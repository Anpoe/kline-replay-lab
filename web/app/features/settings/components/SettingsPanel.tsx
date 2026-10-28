import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Search, Save, Trash2, X } from "lucide-react";
import { marketSelectionLabel } from "../../../lib/dataMarkets";
import type { ExecutionCostProfile, OrderType } from "../../../lib/executionEngine";
import {
  marketOrderQuantityFields,
  MAX_REPLAY_HISTORY_BARS,
  MIN_REPLAY_HISTORY_BARS,
  normalizeReplayHistoryBars,
  pretradePlanFieldOptions,
  type AppSettings,
  type ChartTimeZonePreference,
  type PositionSizeMode,
  type SettingsTab,
} from "../settingsContracts";
import { canAggregateTimeframe, TIMEFRAME_IDS, timeframeLabel } from "../../../lib/timeframeCatalog";

import { findSettingsGroups, settingsCategories, settingsGroups, type SettingsGroupId } from "../settingsNavigation";
import { SettingsHelp } from "../../../components/SettingsHelp";
import { notificationSound } from "../../../lib/notificationSound.mjs";
import { MobileAccessPanel } from "../../mobile-access/MobileAccessPanel";
import { ShortcutSettingsPanel } from "./ShortcutSettingsPanel";

const groupTitle = (id: SettingsGroupId) => settingsGroups.find((group) => group.id === id)!.title;
const groupCategory = (id: SettingsGroupId) => settingsCategories.find((category) => category.id === settingsGroups.find((group) => group.id === id)!.category)!.label;

const chartTimeZoneMarkets = [
  { key: "CN", label: "A 股" },
  { key: "US", label: "美股" },
  { key: "FX", label: "外汇" },
  { key: "GOLD", label: "黄金" },
] as const;

function SettingsSwitch({
  checked,
  disabled = false,
  label,
  descriptionId,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  descriptionId?: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-describedby={descriptionId}
      aria-checked={checked}
      disabled={disabled}
      className={`settings-switch${checked ? " on" : ""}`}
      onClick={onChange}
    >
      <span />
    </button>
  );
}

export type SettingsPanelInstrument = {
  id?: string;
  market: string;
  timeframes?: readonly string[];
};

export type SettingsPanelProps = {
  mt4Available: boolean;
  draft: AppSettings;
  tab: SettingsTab;
  availableInstruments: SettingsPanelInstrument[];
  settingsRandomIncludesCn: boolean;
  settingsRandomIncludesUs: boolean;
  renderDataPanel: (query: string) => ReactNode;
  error: string;
  onDraftChange: (update: (draft: AppSettings) => AppSettings) => void;
  onTabChange: (tab: SettingsTab) => void;
  onClose: () => void;
  onOpenTrash: () => void;
  onSave: () => void;
};

export function SettingsPanel({
  mt4Available,
  draft,
  tab: requestedTab,
  availableInstruments,
  settingsRandomIncludesCn,
  settingsRandomIncludesUs,
  renderDataPanel,
  error,
  onDraftChange,
  onTabChange,
  onClose,
  onOpenTrash,
  onSave,
}: SettingsPanelProps) {
  const tab = requestedTab === "mt4" && !mt4Available ? "basic" : requestedTab;
  const [query, setQuery] = useState("");
  const [soundError, setSoundError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const searching = Boolean(query.trim());
  const visibleGroups = findSettingsGroups(query, tab).filter((group) => mt4Available || group.category !== "mt4");
  const visibleIds = new Set<string>(visibleGroups.map((group) => group.id));
  const category = settingsCategories.find((item) => item.id === tab)!;
  useEffect(() => {
    const revealCategory = () => navigationRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    revealCategory();
    window.addEventListener("resize", revealCategory);
    return () => window.removeEventListener("resize", revealCategory);
  }, [tab, searching]);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    searchRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);
  const selectCategory = (next: SettingsTab) => {
    setQuery("");
    onTabChange(next);
    contentRef.current?.scrollTo({ top: 0 });
  };
  return (
    <div className="task-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="task-modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title" onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); onClose(); }
        if (event.key === "Tab") {
          const targets = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter((target) => target.getClientRects().length);
          const first = targets[0], last = targets.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
        <div className="task-modal-head">
          <div><span>PREFERENCES</span><h2 id="settings-modal-title">设置</h2></div>
          <button type="button" aria-label="关闭设置" onClick={onClose}><X size={19} /></button>
        </div>
        <div className="settings-layout">
          <aside className="settings-sidebar">
            <div className="settings-search"><Search size={15} aria-hidden="true" />
              <input ref={searchRef} type="search" aria-label="搜索全部设置" placeholder="搜索设置…" value={query} onChange={(event) => { setQuery(event.target.value); contentRef.current?.scrollTo({ top: 0 }); }} />
              {query && <button type="button" aria-label="清除搜索" onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X size={14} /></button>}
            </div>
            <nav className="settings-navigation" aria-label="设置分类" ref={navigationRef}>
              {settingsCategories.filter((item) => mt4Available || item.id !== "mt4").map((item) => {
                const count = searching ? visibleGroups.filter((group) => group.category === item.id).length : undefined;
                return <button key={item.id} type="button" aria-current={!searching && tab === item.id ? "page" : undefined} className={!searching && tab === item.id ? "active" : ""} title={item.hint} onClick={() => selectCategory(item.id)}>
                  <span>{item.label}</span>{searching ? <span className="settings-category-count">{count}</span> : <ChevronRight size={13} aria-hidden="true" />}
                </button>;
              })}
            </nav>
          </aside>
          <div className="settings-content" ref={contentRef}>
            <header className="settings-content-head"><h3>{searching ? "搜索结果" : category.label}</h3>
              {searching ? <span role="status">{visibleGroups.length} 个分组</span> : <SettingsHelp label={`${category.label}说明`}>{category.hint}</SettingsHelp>}
            </header>
            <div className="settings-section">
              {searching && visibleGroups.length === 0 && <div className="settings-empty" role="status"><Search size={24} /><strong>没有找到相关设置</strong><button type="button" className="ghost-button" onClick={() => { setQuery(""); searchRef.current?.focus(); }}>清除搜索</button></div>}
              {visibleIds.has("timezone") && <section className="settings-rule settings-group" aria-labelledby="settings-group-timezone" data-settings-group="timezone">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("timezone")}</span>}<h4 id="settings-group-timezone">{groupTitle("timezone")}</h4></div><SettingsHelp label={`${groupTitle("timezone")}说明`}><span>保存后，各市场的训练和复盘图表分别按所选时区显示；训练时段也按该时区判断。周末仍按市场时间判断，纽约和伦敦时间会自动适应冬夏令时。</span></SettingsHelp></header>


                <div className="execution-settings-grid">
                  {chartTimeZoneMarkets.map(({ key, label }) => (
                    <label key={key}>{label}
                      <select value={draft.chartTimeZones[key]} onChange={(event) => onDraftChange((next) => ({
                        ...next,
                        chartTimeZones: {
                          ...next.chartTimeZones,
                          [key]: event.target.value as ChartTimeZonePreference,
                        },
                      }))}>
                        <option value="market">市场时间（默认）</option>
                        <option value="Asia/Shanghai">北京时间</option>
                        <option value="America/New_York">纽约时间</option>
                        <option value="Europe/London">伦敦时间</option>
                        <option value="UTC">UTC 时间</option>
                      </select>
                    </label>
                  ))}
                </div>


              </section>}
              {visibleIds.has("session") && <section className="settings-rule settings-group" aria-labelledby="settings-group-session" data-settings-group="session">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("session")}</span>}<h4 id="settings-group-session">{groupTitle("session")}</h4></div><SettingsHelp label={`${groupTitle("session")}说明`}><span>按该市场所选的图表显示时区判断，包含开始、不含结束；结束早于开始时表示跨午夜，例如 22:00–07:00。</span><span>保存后从下一次推进生效。</span><span>开启“只在指定时段训练”后，还会跳过所选时间外的历史 K 线；已有平仓挂单及止损止盈照常执行，开仓挂单顺延到下一个交易时段。</span><span>仅适用于非随机训练的分钟线、小时线；随机训练、日线及更大周期、实时模拟不受影响。</span></SettingsHelp></header>

                <div className="settings-row-action">
                  <div>

                    <strong>只在指定时段训练</strong>
                  </div>
                  <SettingsSwitch
                    checked={draft.replayTradingSession.enabled}
                    label="只在指定时段训练"
                    onChange={() => onDraftChange((next) => ({
                      ...next,
                      replayTradingSession: { ...next.replayTradingSession, enabled: !next.replayTradingSession.enabled },
                    }))}
                  />
                </div>
                {draft.replayTradingSession.enabled && (
                  <div className="execution-settings-grid">
                    <label>开始时间
                      <input type="time" step="60" value={draft.replayTradingSession.startTime} onChange={(event) => onDraftChange((next) => ({
                        ...next,
                        replayTradingSession: { ...next.replayTradingSession, startTime: event.target.value },
                      }))} />
                    </label>
                    <label>结束时间
                      <input type="time" step="60" value={draft.replayTradingSession.endTime} onChange={(event) => onDraftChange((next) => ({
                        ...next,
                        replayTradingSession: { ...next.replayTradingSession, endTime: event.target.value },
                      }))} />
                    </label>
                  </div>
                )}




                <p className="settings-consequence">下一次推进生效；已有止损、止盈与平仓委托照常执行。</p>
              </section>}
              {visibleIds.has("weekends") && <section className="settings-rule settings-group" aria-labelledby="settings-group-weekends" data-settings-group="weekends">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("weekends")}</span>}<h4 id="settings-group-weekends">{groupTitle("weekends")}</h4></div><SettingsHelp label={`${groupTitle("weekends")}说明`}><span>开启后，单步、快进和自动播放会按市场交易时间跳过周六、周日的历史 K 线；周末不执行委托，已有持仓会保留。</span><span>仅适用于非随机训练的分钟线、小时线；随机训练、日线及更大周期、实时模拟不受影响。</span></SettingsHelp></header>

                <div className="settings-row-action">
                  <div>

                    <strong>自动跳过周末</strong>
                  </div>
                  <SettingsSwitch
                    checked={draft.replayTradingSession.skipWeekends}
                    label="自动跳过周末"
                    onChange={() => onDraftChange((next) => ({
                      ...next,
                      replayTradingSession: { ...next.replayTradingSession, skipWeekends: !next.replayTradingSession.skipWeekends },
                    }))}
                  />
                </div>



              </section>}
              {visibleIds.has("history") && <section className="settings-rule settings-group" aria-labelledby="settings-group-history" data-settings-group="history">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("history")}</span>}<h4 id="settings-group-history">{groupTitle("history")}</h4></div><SettingsHelp label={`${groupTitle("history")}说明`}><span>每次新训练开始时，显示起点左侧最近多少根 K 线；最少 100、最多 5000。训练推进后，新揭示的 K 线会继续追加，已保存训练不会随设置变化。</span></SettingsHelp></header>


                <label>新训练显示根数
                  <input
                    type="number"
                    min={MIN_REPLAY_HISTORY_BARS}
                    max={MAX_REPLAY_HISTORY_BARS}
                    step="1"
                    value={draft.replayHistoryBars}
                    onChange={(event) => onDraftChange((next) => ({ ...next, replayHistoryBars: Number(event.target.value) }))}
                    onBlur={() => onDraftChange((next) => ({ ...next, replayHistoryBars: normalizeReplayHistoryBars(next.replayHistoryBars) }))}
                  />
                </label>


              </section>}
              {visibleIds.has("training-account") && <section className="settings-rule settings-group" aria-labelledby="settings-group-training-account" data-settings-group="training-account">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("training-account")}</span>}<h4 id="settings-group-training-account">{groupTitle("training-account")}</h4></div><SettingsHelp label={`${groupTitle("training-account")}说明`}><span>{draft.trainingAccount.tradingMode === "return"
                  ? "不限制本金和购买力，只比较仓位收益率；风险仓位使用单独的计算基准。"
                  : "按初始资金核算现金、持仓市值和账户权益；买入资金不足时拒单。"}</span><span>只影响之后新建的训练；已开始或已保存训练继续使用创建时冻结的账户配置。</span></SettingsHelp></header>


                <div className="task-start-options">
                  <button
                    className={draft.trainingAccount.tradingMode === "return" ? "active" : ""}
                    onClick={() => onDraftChange((next) => ({
                      ...next,
                      trainingAccount: { ...next.trainingAccount, tradingMode: "return" },
                      tradingMode: "return",
                    }))}
                  >收益率模式</button>
                  <button
                    className={draft.trainingAccount.tradingMode === "capital" ? "active" : ""}
                    onClick={() => onDraftChange((next) => ({
                      ...next,
                      trainingAccount: { ...next.trainingAccount, tradingMode: "capital" },
                      tradingMode: "capital",
                    }))}
                  >资金账户模式</button>
                </div>

                <label>{draft.trainingAccount.tradingMode === "capital" ? "新训练初始资金" : "收益率风险计算基准"}
                  <input
                    type="number"
                    min="1000"
                    step="1000"
                    value={draft.trainingAccount.tradingMode === "capital"
                      ? draft.trainingAccount.initialCapital
                      : draft.trainingAccount.riskCapital}
                    onChange={(event) => onDraftChange((next) => {
                      const amount = Math.max(1000, Number(event.target.value));
                      return {
                        ...next,
                        trainingAccount: {
                          ...next.trainingAccount,
                          ...(next.trainingAccount.tradingMode === "capital"
                            ? { initialCapital: amount }
                            : { riskCapital: amount }),
                        },
                        initialCapital: amount,
                      };
                    })}
                  />
                </label>


                <p className="settings-consequence">仅用于新训练，已有训练保留原配置。</p>
              </section>}
              {visibleIds.has("live-account") && <section className="settings-rule settings-group" aria-labelledby="settings-group-live-account" data-settings-group="live-account">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("live-account")}</span>}<h4 id="settings-group-live-account">{groupTitle("live-account")}</h4></div><SettingsHelp label={`${groupTitle("live-account")}说明`}><span>同一市场内的品种共享资金。已有账户需处理持仓和挂单后重置并新建，才能使用新配置。</span></SettingsHelp></header>


                <div className="task-start-options">
                  <button
                    className={draft.liveAccount.tradingMode === "return" ? "active" : ""}
                    onClick={() => onDraftChange((next) => ({
                      ...next,
                      liveAccount: { ...next.liveAccount, tradingMode: "return" },
                    }))}
                  >收益率模式</button>
                  <button
                    className={draft.liveAccount.tradingMode === "capital" ? "active" : ""}
                    onClick={() => onDraftChange((next) => ({
                      ...next,
                      liveAccount: { ...next.liveAccount, tradingMode: "capital" },
                    }))}
                  >资金账户模式</button>
                </div>
                <div className="execution-settings-grid">
                  <label>{draft.liveAccount.tradingMode === "capital" ? "A 股初始资金" : "A 股风险计算基准"}
                    <input
                      type="number"
                      min="1000"
                      step="1000"
                      value={draft.liveAccount.tradingMode === "capital"
                        ? draft.liveAccount.initialCapitalByMarket.CN
                        : draft.liveAccount.riskCapitalByMarket.CN}
                      onChange={(event) => onDraftChange((next) => {
                        const amount = Math.max(1000, Number(event.target.value));
                        const key = next.liveAccount.tradingMode === "capital"
                          ? "initialCapitalByMarket"
                          : "riskCapitalByMarket";
                        return {
                          ...next,
                          liveAccount: {
                            ...next.liveAccount,
                            [key]: { ...next.liveAccount[key], CN: amount },
                          },
                        };
                      })}
                    />
                  </label>
                  <label>{draft.liveAccount.tradingMode === "capital" ? "美股初始资金" : "美股风险计算基准"}
                    <input
                      type="number"
                      min="1000"
                      step="1000"
                      value={draft.liveAccount.tradingMode === "capital"
                        ? draft.liveAccount.initialCapitalByMarket.US
                        : draft.liveAccount.riskCapitalByMarket.US}
                      onChange={(event) => onDraftChange((next) => {
                        const amount = Math.max(1000, Number(event.target.value));
                        const key = next.liveAccount.tradingMode === "capital"
                          ? "initialCapitalByMarket"
                          : "riskCapitalByMarket";
                        return {
                          ...next,
                          liveAccount: {
                            ...next.liveAccount,
                            [key]: { ...next.liveAccount[key], US: amount },
                          },
                        };
                      })}
                    />
                  </label>
                </div>

                <p className="settings-consequence">仅用于新账户，已有账户保留原配置。</p>
              </section>}
              {visibleIds.has("fx-account") && <section className="settings-rule settings-group" aria-labelledby="settings-group-fx-account" data-settings-group="fx-account">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("fx-account")}</span>}<h4 id="settings-group-fx-account">{groupTitle("fx-account")}</h4></div><SettingsHelp label={`${groupTitle("fx-account")}说明`}><span>外汇和黄金训练固定使用保证金资金账户，不使用收益率模式。账户币种等于报价币时按 1:1 换算；外汇账户币种等于基础币时按汇价反算；其他情况使用上面的手动换算率。参数会随新训练冻结。</span></SettingsHelp></header>


                <div className="execution-settings-grid">
                  <label>账户币种
                    <select value={draft.fxAccountConfig.accountCurrency} onChange={(event) => onDraftChange((next) => ({
                      ...next,
                      fxAccountConfig: { ...next.fxAccountConfig, accountCurrency: event.target.value },
                    }))}>
                      {["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "CNY"].map((currency) => <option value={currency} key={currency}>{currency}</option>)}
                    </select>
                  </label>
                  <label>杠杆
                    <select value={draft.fxAccountConfig.leverage} onChange={(event) => onDraftChange((next) => ({
                      ...next,
                      fxAccountConfig: { ...next.fxAccountConfig, leverage: Number(event.target.value) },
                    }))}>
                      {[1, 10, 20, 30, 50, 100, 200, 500].map((leverage) => <option value={leverage} key={leverage}>1:{leverage}</option>)}
                    </select>
                  </label>
                  <label>强平线（保证金水平 %）
                    <input type="number" min="1" max="1000" step="1" value={draft.fxAccountConfig.stopOutLevelPct} onChange={(event) => onDraftChange((next) => ({
                      ...next,
                      fxAccountConfig: { ...next.fxAccountConfig, stopOutLevelPct: Number(event.target.value) },
                    }))} />
                  </label>
                  <label>第三币种换算率
                    <input type="number" min="0" step="any" placeholder="第三币种必填" value={draft.fxAccountConfig.manualQuoteToAccountRate || ""} onChange={(event) => onDraftChange((next) => ({
                      ...next,
                      fxAccountConfig: { ...next.fxAccountConfig, manualQuoteToAccountRate: Number(event.target.value) },
                    }))} />
                  </label>
                </div>


              </section>}
              {visibleIds.has("quantity") && <section className="settings-rule settings-group" aria-labelledby="settings-group-quantity" data-settings-group="quantity">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("quantity")}</span>}<h4 id="settings-group-quantity">{groupTitle("quantity")}</h4></div><SettingsHelp label={`${groupTitle("quantity")}说明`}><span>新建训练、切换到新市场或打开实时模拟时会按当前市场使用对应值；已保存训练继续沿用训练内记录的下单数量。外汇和黄金可按 0.01 手递增。</span></SettingsHelp></header>


                <div className="execution-settings-grid">
                  {marketOrderQuantityFields.map((field) => (
                    <label key={field.key}>{field.label}
                      <input
                        type="number"
                        min={field.min}
                        step={field.step}
                        value={draft.defaultOrderQtyByMarket[field.key]}
                        onChange={(event) => onDraftChange((next) => ({
                          ...next,
                          defaultOrderQtyByMarket: {
                            ...next.defaultOrderQtyByMarket,
                            [field.key]: Number(event.target.value),
                          },
                        }))}
                      />
                    </label>
                  ))}
                </div>


              </section>}
              {visibleIds.has("order-mode") && <section className="settings-rule settings-group" aria-labelledby="settings-group-order-mode" data-settings-group="order-mode">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("order-mode")}</span>}<h4 id="settings-group-order-mode">{groupTitle("order-mode")}</h4></div><SettingsHelp label={`${groupTitle("order-mode")}说明`}><span>按账户余额 × 风险比例，再结合止损距离、点差/滑点和双边佣金自动反算数量或手数；拖动图表上的止损线会实时重算，没有止损时不会允许下单。</span><span>切换只影响之后新建的训练；已开始和已保存训练会继续使用创建时锁定的账户模式。</span></SettingsHelp></header>


                <div className="execution-settings-grid">
                  <label>默认下单方式
                    <select value={draft.positionSizeMode} onChange={(event) => onDraftChange((next) => ({ ...next, positionSizeMode: event.target.value as PositionSizeMode }))}>
                      <option value="fixed">固定数量</option>
                      <option value="risk-percent">按止损风险（余额%）</option>
                    </select>
                  </label>
                  <label>默认开仓委托
                    <select value={draft.orderType} onChange={(event) => onDraftChange((next) => ({ ...next, orderType: event.target.value as OrderType }))}>
                      <option value="market">市价 · 下一根开盘</option>
                      <option value="limit">限价单（Limit Order）</option>
                      <option value="stop">突破单（Stop Order）</option>
                    </select>
                  </label>
                  {draft.positionSizeMode === "risk-percent" && <label>默认单笔风险（余额%）
                    <input type="number" min="0.1" max="100" step="0.1" value={draft.riskPercent} onChange={(event) => onDraftChange((next) => ({ ...next, riskPercent: Number(event.target.value) }))} />
                  </label>}
                </div>



              </section>}
              {visibleIds.has("execution") && <section className="settings-rule settings-group" aria-labelledby="settings-group-execution" data-settings-group="execution">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("execution")}</span>}<h4 id="settings-group-execution">{groupTitle("execution")}</h4></div><SettingsHelp label={`${groupTitle("execution")}说明`}><span>训练和实时模拟均使用这套参数；参数在新训练或新实时市场账户创建时锁定。成交量参与上限为 0 时整单成交，否则按当根成交量分批撮合、余量继续挂单。</span></SettingsHelp></header>


                <div className="execution-settings-grid">
                  <label>佣金（bp）
                    <input type="number" min="0" step="0.1" value={draft.executionProfile.commissionRateBps} onChange={(event) => onDraftChange((next) => ({
                      ...next,
                      executionProfile: { ...next.executionProfile, commissionRateBps: Number(event.target.value) },
                    }))} />
                  </label>
                  <label>最低佣金
                    <input type="number" min="0" step="0.01" value={draft.executionProfile.minimumCommission} onChange={(event) => onDraftChange((next) => ({
                      ...next,
                      executionProfile: { ...next.executionProfile, minimumCommission: Number(event.target.value) },
                    }))} />
                  </label>
                  <label>滑点（bp）
                    <input type="number" min="0" step="0.1" value={draft.executionProfile.slippageBps} onChange={(event) => onDraftChange((next) => ({
                      ...next,
                      executionProfile: { ...next.executionProfile, slippageBps: Number(event.target.value) },
                    }))} />
                  </label>
                  <label>买卖价差（bp）
                    <input type="number" min="0" step="0.1" value={draft.executionProfile.spreadBps} onChange={(event) => onDraftChange((next) => ({
                      ...next,
                      executionProfile: { ...next.executionProfile, spreadBps: Number(event.target.value) },
                    }))} />
                  </label>
                  <label>单根成交量参与上限（%）
                    <input type="number" min="0" max="100" step="0.1" value={draft.executionProfile.maxVolumeParticipationPct} onChange={(event) => onDraftChange((next) => ({
                      ...next,
                      executionProfile: { ...next.executionProfile, maxVolumeParticipationPct: Number(event.target.value) },
                    }))} />
                  </label>
                </div>
                <label>同一根 K 线同时触发止损与止盈
                  <select value={draft.executionProfile.intrabarConflictPolicy} onChange={(event) => onDraftChange((next) => ({
                    ...next,
                    executionProfile: {
                      ...next.executionProfile,
                      intrabarConflictPolicy: event.target.value as ExecutionCostProfile["intrabarConflictPolicy"],
                    },
                  }))}>
                    <option value="conservative">保守：先止损</option>
                    <option value="optimistic">乐观：先止盈</option>
                    <option value="seeded">种子确定：固定抽样</option>
                  </select>
                </label>


                <p className="settings-consequence">新训练和新实时模拟账户创建时锁定。</p>
              </section>}
              {visibleIds.has("random-instrument") && <section className="settings-rule settings-group" aria-labelledby="settings-group-random-instrument" data-settings-group="random-instrument">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("random-instrument")}</span>}<h4 id="settings-group-random-instrument">{groupTitle("random-instrument")}</h4></div><SettingsHelp label={`${groupTitle("random-instrument")}说明`}><span>默认排除指数、基金、可转债等当前未开放交易的 A 股品种；纳入指数后，抽到指数的训练局只提供看盘、标记和决策功能。</span><span>默认门槛为 100 万美元。按训练起点之前 20 个交易日计算，只影响随机选样；不会删除已下载行情或不可变快照。</span></SettingsHelp></header>


                <div className="task-start-options">
                  {([
                    ["current", "固定当前品种"],
                    ["all", "全部品种随机"],
                    ["market", "指定市场随机"],
                  ] as const).map(([value, label]) => (
                    <button key={value} className={draft.randomInstrumentMode === value ? "active" : ""} onClick={() => onDraftChange((next) => ({ ...next, randomInstrumentMode: value }))}>{label}</button>
                  ))}
                </div>
                {draft.randomInstrumentMode === "market" && (
                  <label>指定市场
                    <select value={draft.randomMarket} onChange={(event) => onDraftChange((next) => ({ ...next, randomMarket: event.target.value }))}>
                      {[...new Set([
                        ...availableInstruments.map((item) => marketSelectionLabel(item.market)),
                        marketSelectionLabel(draft.randomMarket),
                      ].filter(Boolean))].map((market) => <option key={market}>{market}</option>)}
                    </select>
                  </label>
                )}
                {settingsRandomIncludesCn && (<>
                  <div className="task-start-options" aria-label="随机训练指数范围">
                    <button
                      className={!draft.randomIncludeIndices ? "active" : ""}
                      onClick={() => onDraftChange((next) => ({ ...next, randomIncludeIndices: false }))}
                    >仅可交易品种</button>
                    <button
                      className={draft.randomIncludeIndices ? "active" : ""}
                      onClick={() => onDraftChange((next) => ({ ...next, randomIncludeIndices: true }))}
                    >纳入指数（只看盘）</button>
                  </div>

                </>)}
                {settingsRandomIncludesUs && (<>
                  <div className="task-start-options" aria-label="美股流动性过滤">
                    <button
                      className={draft.randomUsLiquidityFilter ? "active" : ""}
                      onClick={() => onDraftChange((next) => ({ ...next, randomUsLiquidityFilter: true }))}
                    >过滤低流动性美股</button>
                    <button
                      className={!draft.randomUsLiquidityFilter ? "active" : ""}
                      onClick={() => onDraftChange((next) => ({ ...next, randomUsLiquidityFilter: false }))}
                    >不过滤</button>
                  </div>
                  {draft.randomUsLiquidityFilter && (
                    <label>最低 20 日平均成交额（美元）
                      <input
                        type="number"
                        min="0"
                        step="100000"
                        value={draft.randomUsMinAverageDailyDollarVolume}
                        onChange={(event) => onDraftChange((next) => ({
                          ...next,
                          randomUsMinAverageDailyDollarVolume: Math.max(0, Number(event.target.value)),
                        }))}
                      />
                    </label>
                  )}

                </>)}

              </section>}
              {visibleIds.has("random-timeframe") && <section className="settings-rule settings-group" aria-labelledby="settings-group-random-timeframe" data-settings-group="random-timeframe">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("random-timeframe")}</span>}<h4 id="settings-group-random-timeframe">{groupTitle("random-timeframe")}</h4></div><SettingsHelp label="随机周期说明"><span>用于抽取训练片段和选择初始图表周期。开始后可切换周期；上一根、下一根每次只移动当前图表的一根。</span></SettingsHelp></header>
                <div className="task-start-options">
                  {([['current', '固定当前周期'], ['all', '全部周期随机'], ['fixed', '指定周期']] as const).map(([value, label]) => (
                    <button key={value} className={draft.randomTimeframeMode === value ? "active" : ""} onClick={() => onDraftChange(next => ({ ...next, randomTimeframeMode: value }))}>{label}</button>
                  ))}
                </div>
                {draft.randomTimeframeMode === "fixed" && <label>指定周期
                  <select value={draft.randomTimeframe} onChange={event => onDraftChange(next => ({ ...next, randomTimeframe: event.target.value }))}>
                    {TIMEFRAME_IDS.map(item => <option key={item} value={item} disabled={!availableInstruments.some(instrument => instrument.timeframes?.some(source => source === item || canAggregateTimeframe(source, item)))}>{timeframeLabel(item)}</option>)}
                  </select>
                </label>}
              </section>}
              {visibleIds.has("random-dates") && <section className="settings-rule settings-group" aria-labelledby="settings-group-random-dates" data-settings-group="random-dates">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("random-dates")}</span>}<h4 id="settings-group-random-dates">{groupTitle("random-dates")}</h4></div></header>


                <div className="task-start-options">
                  <button className={draft.randomDateMode === "all" ? "active" : ""} onClick={() => onDraftChange((next) => ({ ...next, randomDateMode: "all" }))}>全部历史</button>
                  <button className={draft.randomDateMode === "range" ? "active" : ""} onClick={() => onDraftChange((next) => ({ ...next, randomDateMode: "range" }))}>指定时间段</button>
                </div>
                {draft.randomDateMode === "range" && (
                  <div className="task-form-row">
                    <label>开始日期<input type="date" value={draft.randomStartDate} onChange={(event) => onDraftChange((next) => ({ ...next, randomStartDate: event.target.value }))} /></label>
                    <label>结束日期<input type="date" value={draft.randomEndDate} onChange={(event) => onDraftChange((next) => ({ ...next, randomEndDate: event.target.value }))} /></label>
                  </div>
                )}

              </section>}
              {visibleIds.has("random-length") && <section className="settings-rule settings-group" aria-labelledby="settings-group-random-length" data-settings-group="random-length">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("random-length")}</span>}<h4 id="settings-group-random-length">{groupTitle("random-length")}</h4></div><SettingsHelp label={`${groupTitle("random-length")}说明`}><span>范围按本局随机选中的周期 K 线数计算；0 表示从随机起点练到已有数据末尾，不设固定根数上限。切换图表后，每次仍只推进当前周期的一根。</span></SettingsHelp></header>
                <label>范围 K 线数
                  <input type="number" min="0" value={draft.randomLength} onChange={(event) => onDraftChange((next) => ({ ...next, randomLength: Math.max(0, Number(event.target.value)) }))} />

                </label>

              </section>}
              {visibleIds.has("pattern-scan") && <section className="settings-rule settings-group" aria-labelledby="settings-group-pattern-scan" data-settings-group="pattern-scan">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("pattern-scan")}</span>}<h4 id="settings-group-pattern-scan">{groupTitle("pattern-scan")}</h4></div><SettingsHelp label={`${groupTitle("pattern-scan")}说明`}><span>冷却用于去掉同一段走势里的重复命中；扫描强度越大，稀有形态越容易找到，但仍会受服务端有界窗口保护。5m 等短周期若长期无命中，请优先降低趋势升幅阈值。具体形态阈值在左侧“形态”中管理。</span></SettingsHelp></header>


                <div className="task-form-row pattern-scan-settings">
                  <label>相邻命中冷却 K 线数
                    <input type="number" min="0" max="100" value={draft.patternCooldownBars} onChange={(event) => onDraftChange((next) => ({ ...next, patternCooldownBars: Math.max(0, Number(event.target.value)) }))} />
                  </label>
                  <label>随机训练最多检查候选数
                    <input type="number" min="1" max="50" value={draft.patternScanAttempts} onChange={(event) => onDraftChange((next) => ({ ...next, patternScanAttempts: Math.max(1, Number(event.target.value)) }))} />
                  </label>
                </div>


              </section>}
              {visibleIds.has("strict") && <section className="settings-rule settings-group" aria-labelledby="settings-group-strict" data-settings-group="strict">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("strict")}</span>}<h4 id="settings-group-strict">{groupTitle("strict")}</h4></div><SettingsHelp label={`${groupTitle("strict")}说明`}><span>{draft.strictModeEnabled ? "训练、实时模拟和 MT4 网页开仓都使用同一套纪律检查；未完成已启用的规划或 SOP 检查项时，开仓会被拦截。" : "开启后，已启用的纪律将用于训练、实时模拟和 MT4 网页开仓。"}</span></SettingsHelp></header>

                <div className="settings-row-action">
                  <div>

                    <strong>{draft.strictModeEnabled ? "严格模式已开启" : "严格模式未开启"}</strong>

                  </div>
                  <SettingsSwitch
                    checked={draft.strictModeEnabled}
                    label="严格模式"
                    onChange={() => onDraftChange((next) => ({ ...next, strictModeEnabled: !next.strictModeEnabled }))}
                  />
                </div>

              </section>}
              {visibleIds.has("pretrade") && <section className="settings-rule settings-group" aria-labelledby="settings-group-pretrade" data-settings-group="pretrade">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("pretrade")}</span>}<h4 id="settings-group-pretrade">{groupTitle("pretrade")}</h4></div><SettingsHelp label={`${groupTitle("pretrade")}说明`}><span>开启后只检查下面勾选的字段；关闭某一项后，严格模式不再因该项为空而拦截。</span></SettingsHelp></header>

                <div className="settings-row-action">
                  <div>

                    <strong>{draft.requirePretradePlan ? "需要事前规划卡" : "不强制事前规划卡"}</strong>

                  </div>
                  <SettingsSwitch
                    checked={draft.requirePretradePlan}
                    label="需要事前规划卡"
                    onChange={() => onDraftChange((next) => ({ ...next, requirePretradePlan: !next.requirePretradePlan }))}
                  />
                </div>
                <div className={`pretrade-field-list${draft.requirePretradePlan ? "" : " disabled"}`}>
                  {pretradePlanFieldOptions.map((option) => {
                    const selected = draft.requiredPretradeFields.includes(option.key);
                    return (
                      <div className="pretrade-field-row" key={option.key}>
                        <div><strong>{option.label}</strong><SettingsHelp label={`${option.label}说明`}>{option.description}</SettingsHelp></div>
                        <SettingsSwitch
                          checked={selected}
                          disabled={!draft.requirePretradePlan}
                          label={`要求填写${option.label}`}
                          onChange={() => onDraftChange((next) => ({
                            ...next,
                            requiredPretradeFields: selected
                              ? next.requiredPretradeFields.filter((field) => field !== option.key)
                              : [...next.requiredPretradeFields, option.key],
                          }))}
                        />
                      </div>
                    );
                  })}
                </div>

                <p className="settings-consequence">严格模式开启时，未完成必填项会拦截开仓。</p>
              </section>}
              {visibleIds.has("builtin-sop") && <section className="settings-rule settings-group" aria-labelledby="settings-group-builtin-sop" data-settings-group="builtin-sop">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("builtin-sop")}</span>}<h4 id="settings-group-builtin-sop">{groupTitle("builtin-sop")}</h4></div><SettingsHelp label={`${groupTitle("builtin-sop")}说明`}><span>按市场和周期的基础 SOP 检查；它与事前规划卡、个人表现 SOP 是三个独立开关。</span></SettingsHelp></header>

                <div className="settings-row-action">
                  <div>

                    <strong>{draft.sopCheckEnabled ? "启用 SOP 检查" : "关闭 SOP 检查"}</strong>

                  </div>
                  <SettingsSwitch
                    checked={draft.sopCheckEnabled}
                    label="启用 SOP 检查"
                    onChange={() => onDraftChange((next) => ({ ...next, sopCheckEnabled: !next.sopCheckEnabled }))}
                  />
                </div>

              </section>}
              {visibleIds.has("personal-sop") && <section className="settings-rule settings-group" aria-labelledby="settings-group-personal-sop" data-settings-group="personal-sop">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("personal-sop")}</span>}<h4 id="settings-group-personal-sop">{groupTitle("personal-sop")}</h4></div><SettingsHelp label={`${groupTitle("personal-sop")}说明`}><span>{draft.personalSopCheckEnabled
                  ? "已开启；只使用表现页中至少 15 笔样本的已采用规则，管理入场条件、品种资料和持仓范围。事前规划卡由严格模式单独控制。"
                  : "未开启；开启后只使用表现页中至少 15 笔样本的已采用规则，管理入场条件、品种资料和持仓范围。事前规划卡由严格模式单独控制。"}</span><span>{draft.activePersonalSopRule ? "表现页出现新候选时不会自动替换当前规则。" : "请在表现页的个人 SOP 推荐中采用一条满足 15 笔门槛的规则。"}</span><span>仅作用于本地回放；会沿用下一根 K 线成交和 A 股 T+1 预约规则，不绕过市场约束。</span><span>候选组合至少需要 15 笔已平仓样本；样本不足时只显示积累进度。</span></SettingsHelp></header>

                <div className="settings-row-action">
                  <div>

                    <strong>个人表现 SOP</strong>

                  </div>
                  <SettingsSwitch
                    checked={draft.personalSopCheckEnabled}
                    label="个人表现 SOP"
                    onChange={() => onDraftChange((next) => ({ ...next, personalSopCheckEnabled: !next.personalSopCheckEnabled }))}
                  />
                </div>
                <div className="active-personal-sop-summary">
                  <span>当前规则</span>
                  {draft.activePersonalSopRule ? (
                    <strong>{draft.activePersonalSopRule.title} · {draft.activePersonalSopRule.stats.samples} 笔样本 · {timeframeLabel(draft.activePersonalSopRule.scope.timeframe)}</strong>
                  ) : <strong>尚未采用表现推荐</strong>}

                </div>
                <div className="settings-row-action auto-close-row">
                  <div>

                    <strong>{draft.personalSopAutoCloseEnabled ? "超限自动平仓已开启" : "超限只提示"}</strong>

                  </div>
                  <SettingsSwitch
                    checked={draft.personalSopAutoCloseEnabled}
                    disabled={!draft.activePersonalSopRule}
                    label="超出持仓纪律自动平仓"
                    onChange={() => onDraftChange((next) => ({ ...next, personalSopAutoCloseEnabled: !next.personalSopAutoCloseEnabled }))}
                  />
                </div>

                <p className="settings-consequence">超限自动平仓仅作用于本地回放，遵循下一根 K 线成交和 A 股 T+1 规则。</p>
              </section>}
              {visibleIds.has("mt4-enabled") && <section className="settings-rule settings-group" aria-labelledby="settings-group-mt4-enabled" data-settings-group="mt4-enabled">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("mt4-enabled")}</span>}<h4 id="settings-group-mt4-enabled">{groupTitle("mt4-enabled")}</h4></div><SettingsHelp label={`${groupTitle("mt4-enabled")}说明`}><span>保存后显示 MT4 导航入口和面板。关闭会保留连接配置、交易档案和绘图。</span></SettingsHelp></header>

                <div className="settings-row-action" title="保存后显示 MT4 导航入口和面板。关闭会保留连接配置、交易档案和绘图，不会平仓或停止 MT4 中的 EA。">
                  <div><strong>显示 MT4 面板</strong></div>
                  <SettingsSwitch checked={draft.mt4Enabled} label="显示 MT4 面板"
                    onChange={() => onDraftChange(next => ({ ...next, mt4Enabled: !next.mt4Enabled }))} />
                </div>

                <p className="settings-consequence">关闭面板不会平仓或停止 MT4 中的 EA。</p>
              </section>}
              {visibleIds.has("mt4-motion") && <section className="settings-rule settings-group" aria-labelledby="settings-group-mt4-motion" data-settings-group="mt4-motion">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("mt4-motion")}</span>}<h4 id="settings-group-mt4-motion">{groupTitle("mt4-motion")}</h4></div><SettingsHelp label={`${groupTitle("mt4-motion")}说明`}><span>开启后，每根 K 线只在开盘后与收盘前的指定秒数内实时更新，中间冻结图表与浮动盈亏。报价、持仓变动、交易和历史保存继续实时更新。首次进入、切换品种或周期、换根时显示一次当前数据；历史回看不冻结。</span></SettingsHelp></header>

                <div className="settings-row-action" title="开启后，每根 K 线只在开盘后与收盘前的指定秒数内实时更新，中间冻结图表与浮动盈亏。报价、持仓变动、交易和历史保存继续实时更新。首次进入或切换品种、周期及换根时显示一次当前真实数据，历史回看不冻结。">
                  <div><strong>仅显示开收盘波动</strong></div>
                  <SettingsSwitch checked={draft.mt4ChartMotion.enabled} label="仅显示开收盘波动" descriptionId="settings-mt4-window-help"
                    onChange={() => onDraftChange(next => ({ ...next, mt4ChartMotion: { ...next.mt4ChartMotion, enabled: !next.mt4ChartMotion.enabled } }))} />
                </div>

                <div className="settings-row-action" title="开启后，每次图表从冻结恢复实时波动时播放一次；首次打开、切换图表和持续更新不重复提示。可点击试听启用浏览器声音。">
                  <div><strong>开始波动提示音</strong></div>
                  <button type="button" className="ghost-button" aria-label="试听开始波动提示音" onClick={async () => setSoundError(await notificationSound.preview() ? "" : "无法播放提示音，请允许此页面播放声音后重试试听。")}>试听</button>
                  <SettingsSwitch checked={draft.mt4ChartMotion.soundEnabled} label="开始波动提示音" descriptionId="settings-mt4-sound-help"
                    onChange={() => onDraftChange(next => ({ ...next, mt4ChartMotion: { ...next.mt4ChartMotion, soundEnabled: !next.mt4ChartMotion.soundEnabled } }))} />
                </div>
                <span id="settings-mt4-sound-help" className="live-sr-only">仅在开启开收盘波动窗口时生效；每次解除冻结播放一次，试听可确认浏览器声音是否可用。</span>
                {soundError && <div className="mt4-error" role="alert">{soundError}</div>}
                <span id="settings-mt4-window-help" className="live-sr-only">开盘后、收盘前秒数均为 1–86400 的整数；两个窗口覆盖整根 K 线时持续更新。按 MT4 服务器时间计算。</span>
                <div className="execution-settings-grid">
                  <label title="每根 K 线开盘后允许更新的秒数；1–86400 的整数。两个窗口覆盖整根 K 线时持续更新。">开盘后（秒）
                    <input aria-label="开盘后波动秒数" aria-describedby="settings-mt4-window-help" type="number" min="1" max="86400" step="1" disabled={!draft.mt4ChartMotion.enabled} value={draft.mt4ChartMotion.startSeconds}
                      onChange={event => onDraftChange(next => ({ ...next, mt4ChartMotion: { ...next.mt4ChartMotion, startSeconds: Number(event.target.value) } }))} />
                  </label>
                  <label title="每根 K 线收盘前允许更新的秒数；1–86400 的整数。按 MT4 服务器时间计算，两个窗口重叠时持续更新。">收盘前（秒）
                    <input aria-label="收盘前波动秒数" aria-describedby="settings-mt4-window-help" type="number" min="1" max="86400" step="1" disabled={!draft.mt4ChartMotion.enabled} value={draft.mt4ChartMotion.endSeconds}
                      onChange={event => onDraftChange(next => ({ ...next, mt4ChartMotion: { ...next.mt4ChartMotion, endSeconds: Number(event.target.value) } }))} />
                  </label>
                </div>

              </section>}
              {visibleIds.has("trash") && <section className="settings-rule settings-group" aria-labelledby="settings-group-trash" data-settings-group="trash">
                <header className="settings-group-head"><div>{searching && <span className="settings-group-category">{groupCategory("trash")}</span>}<h4 id="settings-group-trash">{groupTitle("trash")}</h4></div><SettingsHelp label={`${groupTitle("trash")}说明`}><span>删除的训练会暂存在这里，可以恢复；彻底删除后将无法找回。</span></SettingsHelp></header>

                <div className="settings-row-action">
                  <div>

                    <strong>已删除训练</strong>

                  </div>
                  <button className="ghost-button trash-entry-button" onClick={onOpenTrash} type="button">
                    <Trash2 size={15} />打开回收站
                  </button>
                </div>

                <p className="settings-consequence">彻底删除后无法找回。</p>
              </section>}
              {visibleIds.has("shortcuts") && <ShortcutSettingsPanel value={draft.shortcuts} query={query} onChange={shortcuts => onDraftChange(next => ({ ...next, shortcuts }))} />}
              {visibleIds.has("mobile-access") && <MobileAccessPanel />}
              {visibleIds.has("providers") && <section className="settings-provider-group" aria-label="行情更新与数据连接" data-settings-group="providers">
                {searching && <span className="settings-group-category">{groupCategory("providers")}</span>}
                <p className="settings-consequence">此处的连接与更新设置通过各自操作即时保存。</p>
                {renderDataPanel(query)}
              </section>}
            </div>
          </div>
        </div>
        <footer className="settings-footer">
          {error && <div className="task-error" role="alert">{error}</div>}
          <div className="task-modal-actions"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button type="button" className="primary-button" onClick={onSave}><Save size={16} />保存设置</button></div>
        </footer>
      </section>
    </div>
  );
}
