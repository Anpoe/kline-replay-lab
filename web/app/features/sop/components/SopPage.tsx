import { ArrowRight, Check, CircleAlert, Settings2, ShieldCheck } from "lucide-react";
import type { SopProfileId, SopProfileView } from "../sopContracts";

export type SopPageProps = {
  profiles: SopProfileView[];
  selectedProfileId: SopProfileId;
  currentProfileId: SopProfileId | null;
  strictModeEnabled: boolean;
  requirePretradePlan: boolean;
  sopCheckEnabled: boolean;
  onSelectProfile: (id: SopProfileId) => void;
  onOpenSettings: () => void;
};

function resultLabel(value: number) {
  if (!value) return "0.00%";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function percentageLabel(value: number) {
  return `${value.toFixed(value % 1 ? 1 : 0)}%`;
}

export function SopPage({
  profiles,
  selectedProfileId,
  currentProfileId,
  strictModeEnabled,
  requirePretradePlan,
  sopCheckEnabled,
  onSelectProfile,
  onOpenSettings,
}: SopPageProps) {
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0];
  if (!selectedProfile) return null;

  return (
    <section className="content-page sop-page">
      <div className="page-heading sop-page-heading">
        <div>
          <span>SYSTEM OF PROCESS</span>
          <h1>我的交易 SOP</h1>
          <p>把已经确认的交易习惯，变成开仓前能执行、训练后能复盘的检查表。</p>
        </div>
        <button type="button" className="ghost-button" onClick={onOpenSettings}><Settings2 size={16} />交易纪律设置</button>
      </div>

      <section className={`sop-mode-banner${strictModeEnabled ? " enabled" : ""}`} aria-label="严格模式状态">
        <div className="sop-mode-icon">{strictModeEnabled ? <ShieldCheck size={22} /> : <CircleAlert size={22} />}</div>
        <div className="sop-mode-copy">
          <strong>{strictModeEnabled ? "严格模式已开启" : "严格模式未开启"}</strong>
          <span>{strictModeEnabled
            ? "开仓前会按下面的纪律设置检查当前训练卡片。"
            : "当前只展示 SOP，不会阻止你的训练下单；打开设置即可启用门禁。"}</span></div>
        <div className="sop-mode-chips">
          <span className={requirePretradePlan ? "on" : "off"}>{requirePretradePlan ? "✓" : "—"} 事前规划卡</span>
          <span className={sopCheckEnabled ? "on" : "off"}>{sopCheckEnabled ? "✓" : "—"} SOP 检查</span>
        </div>
        <button type="button" className="text-button" onClick={onOpenSettings}>调整<ArrowRight size={14} /></button>
      </section>

      <div className="sop-profile-grid" role="tablist" aria-label="SOP 版本">
        {profiles.map((profile) => {
          const selected = profile.id === selectedProfile.id;
          const current = profile.id === currentProfileId;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              className={`sop-profile-card${selected ? " active" : ""}${current ? " current" : ""}`}
              key={profile.id}
              onClick={() => onSelectProfile(profile.id)}
            >
              <div className="sop-profile-card-head">
                <div><span>{profile.marketLabel} · {profile.timeframe}</span><strong>{profile.title}</strong></div>
                <b>{profile.version}</b>
              </div>
              <p>{profile.subtitle}</p>
              <div className="sop-profile-metrics">
                <span><small>样本</small><strong>{profile.sampleCount || "—"}</strong></span>
                <span><small>胜率</small><strong>{profile.sampleCount ? percentageLabel(profile.winRate) : "—"}</strong></span>
                <span><small>计划完整</small><strong>{profile.sampleCount ? percentageLabel(profile.completePlanRate) : "—"}</strong></span>
              </div>
              {current && <em>当前训练适用</em>}
            </button>
          );
        })}
      </div>

      <div className="sop-detail-layout">
        <article className="sop-detail-card sop-rules-card">
          <div className="sop-detail-head">
            <div><span className="section-label">ACTIVE RULESET · {selectedProfile.version}</span><h2>{selectedProfile.title}</h2><p>{selectedProfile.thesis}</p></div>
            {selectedProfile.id === currentProfileId && <span className="sop-current-badge"><Check size={13} />当前训练</span>}
          </div>
          <div className="sop-rule-list">
            {selectedProfile.rules.map((rule, index) => (
              <div className="sop-rule-item" key={rule.id}>
                <span className="sop-rule-index">{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{rule.label}</strong><p>{rule.description}</p></div>
                {rule.required && <small>必查</small>}
              </div>
            ))}
          </div>
          <div className="sop-guardrails">
            <span className="section-label">GUARDRAILS</span>
            {selectedProfile.guardrails.map((guardrail) => <span key={guardrail}>· {guardrail}</span>)}
          </div>
        </article>

        <aside className="sop-side-stack">
          <article className="sop-detail-card sop-stats-card">
            <div className="sop-detail-head compact"><div><span className="section-label">SAMPLE SIGNAL</span><h2>当前样本反馈</h2></div></div>
            {selectedProfile.sampleCount ? (
              <div className="sop-stats-grid">
                <div><small>有效样本</small><strong>{selectedProfile.sampleCount}</strong></div>
                <div><small>平均结果</small><strong className={selectedProfile.averageResult >= 0 ? "up" : "down"}>{resultLabel(selectedProfile.averageResult)}</strong></div>
                <div><small>胜 / 负</small><strong>{selectedProfile.winCount} / {selectedProfile.sampleCount - selectedProfile.winCount}</strong></div>
                <div><small>计划完整度</small><strong>{percentageLabel(selectedProfile.completePlanRate)}</strong></div>
              </div>
            ) : (
              <div className="sop-empty-state"><strong>还没有匹配样本</strong><span>完成并保存一场 {selectedProfile.marketLabel} {selectedProfile.timeframe} 训练后，这里会自动出现反馈。</span></div>
            )}
          </article>

          <article className="sop-detail-card sop-gate-card">
            <div className="sop-detail-head compact"><div><span className="section-label">BEFORE ENTRY</span><h2>开仓前检查</h2></div><ShieldCheck size={18} /></div>
            <div className="sop-gate-list">
              <div><span className={strictModeEnabled && requirePretradePlan ? "active" : ""}>{strictModeEnabled && requirePretradePlan ? "✓" : "1"}</span><p><strong>事前规划卡</strong><small>{requirePretradePlan ? "当前 K 线必须有手动提交记录" : "已关闭，不作为开仓门槛"}</small></p></div>
              <div><span className={strictModeEnabled && sopCheckEnabled ? "active" : ""}>{strictModeEnabled && sopCheckEnabled ? "✓" : "2"}</span><p><strong>结构化 SOP 检查</strong><small>{sopCheckEnabled ? "状态、位置、理由、失效点、目标" : "已关闭，只保留其他设置"}</small></p></div>
              <div><span>3</span><p><strong>市场规则检查</strong><small>继续执行原有的价格、数量、资金和撮合规则</small></p></div>
            </div>
            <button type="button" className="text-button" onClick={onOpenSettings}>打开交易纪律设置<ArrowRight size={14} /></button>
          </article>
        </aside>
      </div>
    </section>
  );
}
