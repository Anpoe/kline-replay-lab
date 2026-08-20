import type { ReactNode } from "react";
import { Save, Trash2, X } from "lucide-react";
import { marketSelectionLabel } from "../../../lib/dataMarkets";
import type { ExecutionCostProfile, OrderType } from "../../../lib/executionEngine";
import { pretradePlanFieldOptions } from "../../../lib/tradingDiscipline";
import {
  marketOrderQuantityFields,
  MAX_REPLAY_HISTORY_BARS,
  MIN_REPLAY_HISTORY_BARS,
  normalizeReplayHistoryBars,
  timeframes,
  type AppSettings,
  type PositionSizeMode,
  type SettingsTab,
} from "../settingsContracts";

export type SettingsPanelInstrument = {
  market: string;
};

export type SettingsPanelProps = {
  draft: AppSettings;
  tab: SettingsTab;
  availableInstruments: SettingsPanelInstrument[];
  settingsRandomIncludesCn: boolean;
  settingsRandomIncludesUs: boolean;
  dataPanel: ReactNode;
  error: string;
  onDraftChange: (update: (draft: AppSettings) => AppSettings) => void;
  onTabChange: (tab: SettingsTab) => void;
  onClose: () => void;
  onOpenTrash: () => void;
  onSave: () => void;
};

export function SettingsPanel({
  draft,
  tab,
  availableInstruments,
  settingsRandomIncludesCn,
  settingsRandomIncludesUs,
  dataPanel,
  error,
  onDraftChange,
  onTabChange,
  onClose,
  onOpenTrash,
  onSave,
}: SettingsPanelProps) {
  return (
    <div className="task-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="task-modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
        <div className="task-modal-head">
          <div>
            <span>SETTINGS</span>
            <h2 id="settings-modal-title">本地设置</h2>
            <p>管理训练偏好、随机抽样规则和本机数据源凭证。</p>
          </div>
          <button aria-label="关闭设置" onClick={onClose}><X size={19} /></button>
        </div>

        <div className="settings-tabs" role="tablist" aria-label="设置分类">
          <button className={tab === "basic" ? "active" : ""} onClick={() => onTabChange("basic")}>基本设置</button>
          <button className={tab === "training" ? "active" : ""} onClick={() => onTabChange("training")}>训练设置</button>
          <button className={tab === "discipline" ? "active" : ""} onClick={() => onTabChange("discipline")}>交易纪律</button>
          <button className={tab === "data" ? "active" : ""} onClick={() => onTabChange("data")}>数据源设置</button>
        </div>

        {tab === "basic" ? (
          <div className="settings-section">
            <div className="settings-section-head">
              <strong>新训练默认值</strong>
              <span>打开“新建 Replay 训练”时优先使用这些选项。</span>
            </div>
            <div className="settings-rule">
              <span>模拟交易账户</span>
              <div className="task-start-options">
                <button
                  className={draft.tradingMode === "return" ? "active" : ""}
                  onClick={() => onDraftChange((next) => ({ ...next, tradingMode: "return" }))}
                >收益率模式</button>
                <button
                  className={draft.tradingMode === "capital" ? "active" : ""}
                  onClick={() => onDraftChange((next) => ({ ...next, tradingMode: "capital" }))}
                >资金账户模式</button>
              </div>
              <small>{draft.tradingMode === "return"
                ? "不限制本金和购买力，只比较仓位收益率，适合练习入场与出场质量。"
                : "按初始资金核算现金、持仓市值和账户权益；买入资金不足时拒单。"}</small>
              {draft.tradingMode === "capital" && (
                <label>新训练初始资金
                  <input
                    type="number"
                    min="1000"
                    step="1000"
                    value={draft.initialCapital}
                    onChange={(event) => onDraftChange((next) => ({ ...next, initialCapital: Math.max(1000, Number(event.target.value)) }))}
                  />
                </label>
              )}
            </div>
            <div className="settings-rule">
              <span>不同市场默认下单数量 / 手数</span>
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
              <small>新建训练、切换到新市场或打开实盘观察时会按当前市场使用对应值；已保存训练继续沿用训练内记录的下单数量。外汇可按 0.01 手递增。</small>
            </div>
            <div className="settings-rule">
              <span>下单方式</span>
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
                    <option value="limit">限价 · 触价或更优</option>
                    <option value="stop">止损触发 · 突破后成交</option>
                  </select>
                </label>
                {draft.positionSizeMode === "risk-percent" && <label>默认单笔风险（余额%）
                  <input type="number" min="0.1" max="100" step="0.1" value={draft.riskPercent} onChange={(event) => onDraftChange((next) => ({ ...next, riskPercent: Number(event.target.value) }))} />
                </label>}
              </div>
              <small>按账户余额 × 风险比例，再结合止损距离、点差/滑点和双边佣金自动反算数量或手数；拖动图表上的止损线会实时重算，没有止损时不会允许下单。</small>
              <small>切换只影响之后新建的训练；已开始和已保存训练会继续使用创建时锁定的账户模式。</small>
            </div>
            <div className="settings-rule">
              <span>外汇保证金账户</span>
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
              <small>外汇训练固定使用保证金资金账户。账户币种等于报价币时按 1:1 换算；等于基础币时按当前汇价反算；只有第三币种账户才使用上面的手动换算率。参数会随新训练冻结。</small>
            </div>
            <div className="settings-rule">
              <span>确定性成交引擎</span>
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
              <small>参数在新训练创建时锁定并随保存点恢复；成交量参与上限为 0 时整单成交，否则按当根成交量分批撮合、余量继续挂单。实盘观察仍沿用零成本、次日开盘模型。</small>
            </div>
            <div className="settings-rule">
              <span>图表左侧历史 K 线</span>
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
              <small>每次新训练开始时，显示起点左侧最近多少根 K 线；最少 100、最多 5000。训练推进后，新揭示的 K 线会继续追加，已保存训练不会随设置变化。</small>
            </div>
            <div className="settings-rule trash-settings-rule">
              <div className="settings-row-action">
                <div>
                  <span>训练回收站</span>
                  <strong>已删除训练</strong>
                  <small>删除的训练会暂存在这里，可以恢复；彻底删除后将无法找回。</small>
                </div>
                <button className="ghost-button trash-entry-button" onClick={onOpenTrash} type="button">
                  <Trash2 size={15} />打开回收站
                </button>
              </div>
            </div>
          </div>
        ) : tab === "training" ? (
          <div className="settings-section">
            <div className="settings-section-head">
              <strong>随机训练规则</strong>
              <span>点击顶部“随机训练”时，按这里的范围抽取品种、周期和历史片段。</span>
            </div>

            <div className="settings-rule">
              <span>如何选择品种</span>
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
                <small>默认排除指数、基金、可转债等当前未开放交易的 A 股品种；纳入指数后，抽到指数的训练局只提供看盘、标记和决策功能。</small>
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
                <small>默认门槛为 100 万美元。按训练起点之前 20 个交易日计算，只影响随机选样；不会删除已下载行情或不可变快照。</small>
              </>)}
            </div>

            <div className="settings-rule">
              <span>如何选择时间周期</span>
              <div className="task-start-options">
                {([
                  ["current", "固定当前周期"],
                  ["all", "全部周期随机"],
                  ["fixed", "指定周期"],
                ] as const).map(([value, label]) => (
                  <button key={value} className={draft.randomTimeframeMode === value ? "active" : ""} onClick={() => onDraftChange((next) => ({ ...next, randomTimeframeMode: value }))}>{label}</button>
                ))}
              </div>
              {draft.randomTimeframeMode === "fixed" && (
                <label>指定周期
                  <select value={draft.randomTimeframe} onChange={(event) => onDraftChange((next) => ({ ...next, randomTimeframe: event.target.value }))}>
                    {timeframes.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
              )}
            </div>

            <div className="settings-rule">
              <span>随机历史时间段</span>
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
            </div>

            <label className="task-wide-field">默认训练长度（揭示 K 线数）
              <input type="number" min="0" value={draft.randomLength} onChange={(event) => onDraftChange((next) => ({ ...next, randomLength: Math.max(0, Number(event.target.value)) }))} />
              <small>每局随机训练的默认长度；0 表示一直练到该数据集末尾。</small>
            </label>

            <div className="settings-rule">
              <span>形态筛选扫描</span>
              <div className="task-form-row pattern-scan-settings">
                <label>相邻命中冷却 K 线数
                  <input type="number" min="0" max="100" value={draft.patternCooldownBars} onChange={(event) => onDraftChange((next) => ({ ...next, patternCooldownBars: Math.max(0, Number(event.target.value)) }))} />
                </label>
                <label>随机训练最多检查候选数
                  <input type="number" min="1" max="50" value={draft.patternScanAttempts} onChange={(event) => onDraftChange((next) => ({ ...next, patternScanAttempts: Math.max(1, Number(event.target.value)) }))} />
                </label>
              </div>
              <small>冷却用于去掉同一段走势里的重复命中；扫描强度越大，稀有形态越容易找到，但仍会受服务端有界窗口保护。5m 等短周期若长期无命中，请优先降低趋势升幅阈值。具体形态阈值在左侧“形态”中管理。</small>
            </div>
          </div>
        ) : tab === "discipline" ? (
          <div className="settings-section discipline-settings">
            <div className="settings-section-head">
              <strong>严格模式</strong>
              <span>把交易纪律放到训练开仓入口，设置保存后立即用于当前训练。</span>
            </div>

            <div className={`discipline-master-card${draft.strictModeEnabled ? " enabled" : ""}`}>
              <div>
                <span className="section-label">EXECUTION DISCIPLINE</span>
                <strong>{draft.strictModeEnabled ? "严格模式已开启" : "严格模式未开启"}</strong>
                <small>{draft.strictModeEnabled ? "不满足已开启的门禁时，训练开仓会被拒绝并留下原因。" : "先以普通模式训练；开启后才会拦截不完整的开仓计划。"}</small>
              </div>
              <button
                type="button"
                className={`discipline-switch${draft.strictModeEnabled ? " active" : ""}`}
                aria-label={draft.strictModeEnabled ? "关闭严格模式" : "开启严格模式"}
                aria-pressed={draft.strictModeEnabled}
                onClick={() => onDraftChange((next) => ({ ...next, strictModeEnabled: !next.strictModeEnabled }))}
              ><span aria-hidden="true" /></button>
            </div>

            <div className="settings-rule discipline-rule">
              <div className="discipline-option-row">
                <div>
                  <strong>需要事前规划卡</strong>
                  <small>开仓前必须在当前 K 线上手动提交计划；自动关联保护价和补写记录不算事前计划。</small>
                </div>
                <button
                  type="button"
                  className={`discipline-switch small${draft.requirePretradePlan ? " active" : ""}`}
                  aria-label={draft.requirePretradePlan ? "关闭事前规划卡" : "开启事前规划卡"}
                  aria-pressed={draft.requirePretradePlan}
                  onClick={() => onDraftChange((next) => ({ ...next, requirePretradePlan: !next.requirePretradePlan }))}
                ><span aria-hidden="true" /></button>
              </div>
              <div className="discipline-field-settings">
                <div className="discipline-field-settings-head">
                  <div>
                    <strong>规划卡必填项</strong>
                    <small>可选项包括计划说明；关闭某项后，只影响事前规划卡，不会因为该项为空拦截；SOP 检查仍单独生效。</small>
                  </div>
                  <span>{draft.requiredPretradeFields.length}/{pretradePlanFieldOptions.length}</span>
                </div>
                <div className="discipline-field-list">
                  {pretradePlanFieldOptions.map((field) => {
                    const enabled = draft.requiredPretradeFields.includes(field.key);
                    return (
                      <div className="discipline-field-row" key={field.key}>
                        <div>
                          <strong>{field.label}</strong>
                          <small>{field.description}</small>
                        </div>
                        <button
                          type="button"
                          className={`discipline-switch small${enabled ? " active" : ""}`}
                          aria-label={`${enabled ? "关闭" : "开启"}规划卡必填项：${field.label}`}
                          aria-pressed={enabled}
                          onClick={() => onDraftChange((next) => ({
                            ...next,
                            requiredPretradeFields: enabled
                              ? next.requiredPretradeFields.filter((item) => item !== field.key)
                              : [...next.requiredPretradeFields, field.key],
                          }))}
                        ><span aria-hidden="true" /></button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="settings-rule discipline-rule">
              <div className="discipline-option-row">
                <div>
                  <strong>启用 SOP 检查</strong>
                  <small>按当前市场和周期匹配 SOP；第一阶段检查市场状态、位置、至少两个理由、失效点和第一目标。</small>
                </div>
                <button
                  type="button"
                  className={`discipline-switch small${draft.sopCheckEnabled ? " active" : ""}`}
                  aria-label={draft.sopCheckEnabled ? "关闭 SOP 检查" : "开启 SOP 检查"}
                  aria-pressed={draft.sopCheckEnabled}
                  onClick={() => onDraftChange((next) => ({ ...next, sopCheckEnabled: !next.sopCheckEnabled }))}
                ><span aria-hidden="true" /></button>
              </div>
            </div>

            <div className="discipline-profile-list">
              <div className="settings-section-head"><strong>当前 SOP 版本</strong><span>三个版本先作为 v1.0 基线，页面中的样本反馈会持续更新。</span></div>
              <div className="discipline-profile-row"><span><b>美股日线版</b><small>趋势延续与突破回踩</small></span><em>US · 1d · v1.0</em></div>
              <div className="discipline-profile-row"><span><b>A 股日线版</b><small>趋势位置与交易规则</small></span><em>CN · 1d · v1.0</em></div>
              <div className="discipline-profile-row"><span><b>EURUSD 5 分钟版</b><small>高周期背景与盘中触发</small></span><em>FX · 5m · v1.0</em></div>
            </div>

            <div className="discipline-note"><strong>使用说明</strong><span>严格模式关闭时，三个开关只保存偏好，不改变下单。没有适用 SOP 的其他市场不会被 SOP 检查拦截；原有市场规则仍照常生效。</span></div>
          </div>
        ) : (
          dataPanel
        )}

        {error && <div className="task-error">{error}</div>}
        <div className="task-modal-actions">
          <button className="ghost-button" onClick={onClose}>{tab === "data" ? "关闭" : "取消"}</button>
          {tab !== "data" && <button className="primary-button" onClick={onSave}><Save size={16} />保存设置</button>}
        </div>
      </section>
    </div>
  );
}
