import {
  evaluatePersonalSopEntry,
  normalizePersonalSopRule,
  type PersonalSopRecommendation,
  type PersonalSopEntryInput,
  type PersonalSopScope,
  type PersonalSopRule,
} from "../../lib/performanceSop.ts";
import type { PretradePlanField } from "../settings/settingsContracts.ts";

export type SopDecisionInput = {
  marketState: string;
  location: string;
  reasons: string[];
  stop: string;
  target: string;
  note: string;
  score: number;
  hasStop?: boolean;
  hasTarget?: boolean;
  hasNote?: boolean;
};

export type DisciplineGateInput = {
  strictModeEnabled: boolean;
  requirePretradePlan: boolean;
  requiredPretradeFields: PretradePlanField[];
  sopCheckEnabled: boolean;
  personalSopCheckEnabled: boolean;
  activePersonalSopRule: PersonalSopRule | null;
  scope: PersonalSopEntryInput["scope"];
  decision: SopDecisionInput;
  patterns: string[];
  instrument?: PersonalSopEntryInput["instrument"];
  riskReward?: number;
};

export type DisciplineCheck = {
  id: "pretrade-plan" | "builtin-sop" | "personal-sop";
  status: "pass" | "warning" | "blocked";
  message: string;
};

export type DisciplineGateResult = {
  allowed: boolean;
  checks: DisciplineCheck[];
};

export type BuiltinSopProfile = {
  id: string;
  label: string;
  market: string;
  timeframe: string;
};

const builtinProfiles: BuiltinSopProfile[] = [
  { id: "us-daily-v1", label: "美股日线版", market: "US", timeframe: "1d" },
  { id: "cn-daily-v1", label: "A股日线版", market: "CN", timeframe: "1d" },
  { id: "eurusd-5m-v1", label: "EURUSD 5 分钟版", market: "FX", timeframe: "5m" },
];

export function personalSopScopeKey(scope: Pick<PersonalSopScope, "market" | "timeframe">) {
  return `${scope.market}|${scope.timeframe}`;
}

export function filterPersonalSopRecommendations<T extends Pick<PersonalSopRecommendation, "scope">>(
  recommendations: T[],
  scope: Pick<PersonalSopScope, "market" | "timeframe">,
) {
  const selectedKey = personalSopScopeKey(scope);
  return recommendations.filter((recommendation) => personalSopScopeKey(recommendation.scope) === selectedKey);
}

const pretradeFieldLabels: Record<PretradePlanField, string> = {
  marketState: "市场状态",
  location: "当前位置",
  reasons: "交易理由",
  stop: "止损",
  target: "第一目标",
  note: "计划说明",
};

export function findBuiltinSopProfile(scope: DisciplineGateInput["scope"]) {
  return builtinProfiles.find((profile) => profile.market === scope.market && profile.timeframe === scope.timeframe);
}

function decisionFieldMissing(decision: SopDecisionInput, field: PretradePlanField) {
  if (field === "marketState") return !decision.marketState.trim();
  if (field === "location") return !decision.location.trim();
  if (field === "reasons") return decision.reasons.length === 0;
  if (field === "stop") return !decision.stop.trim();
  if (field === "target") return !decision.target.trim();
  return !decision.note.trim();
}

function evaluatePretradePlan(input: DisciplineGateInput): DisciplineCheck {
  if (!input.requirePretradePlan || !input.requiredPretradeFields.length) {
    return { id: "pretrade-plan", status: "pass", message: "事前规划卡未启用字段门禁" };
  }
  const missing = input.requiredPretradeFields.filter((field) => decisionFieldMissing(input.decision, field));
  return missing.length
    ? { id: "pretrade-plan", status: "blocked", message: `事前规划卡缺少：${missing.map((field) => pretradeFieldLabels[field]).join("、")}` }
    : { id: "pretrade-plan", status: "pass", message: "事前规划卡字段已完成" };
}

function evaluateBuiltinSop(input: DisciplineGateInput): DisciplineCheck {
  const profile = findBuiltinSopProfile(input.scope);
  if (!profile) return { id: "builtin-sop", status: "warning", message: "当前市场/周期暂无内置 SOP，个人规划仍可继续检查" };
  const missing: string[] = [];
  if (input.requiredPretradeFields.includes("marketState") && !input.decision.marketState.trim()) missing.push("市场状态");
  if (input.requiredPretradeFields.includes("location") && !input.decision.location.trim()) missing.push("当前位置");
  if (input.requiredPretradeFields.includes("reasons") && input.decision.reasons.length < 2) missing.push("至少两个交易理由");
  if (input.requiredPretradeFields.includes("stop") && !input.decision.stop.trim()) missing.push("止损");
  if (input.requiredPretradeFields.includes("target") && !input.decision.target.trim()) missing.push("第一目标");
  return missing.length
    ? { id: "builtin-sop", status: "blocked", message: `${profile.label}缺少：${missing.join("、")}` }
    : { id: "builtin-sop", status: "pass", message: `${profile.label}检查通过` };
}

function evaluatePersonalSop(input: DisciplineGateInput): DisciplineCheck {
  const rule = normalizePersonalSopRule(input.activePersonalSopRule);
  if (!rule) return { id: "personal-sop", status: "warning", message: "尚未采用满足 15 笔门槛的个人 SOP" };
  const result = evaluatePersonalSopEntry({
    rule,
    scope: input.scope,
    decision: {
      marketState: input.decision.marketState,
      location: input.decision.location,
      reasons: input.decision.reasons,
      score: input.decision.score,
      hasStop: input.decision.hasStop ?? Boolean(input.decision.stop.trim()),
      hasTarget: input.decision.hasTarget ?? Boolean(input.decision.target.trim()),
      hasNote: input.decision.hasNote ?? Boolean(input.decision.note.trim()),
    },
    patterns: input.patterns,
    instrument: input.instrument,
    riskReward: input.riskReward,
  });
  const mismatches = result.checks.filter((check) => check.status === "mismatch");
  const missing = result.checks.filter((check) => check.status === "missing");
  if (mismatches.length) return { id: "personal-sop", status: "blocked", message: `个人 SOP 不匹配：${mismatches.map((check) => check.label).join("、")}` };
  if (missing.length) return { id: "personal-sop", status: "warning", message: `个人 SOP 有资料待核验：${missing.map((check) => check.label).join("、")}` };
  return { id: "personal-sop", status: "pass", message: "个人表现 SOP 检查通过" };
}

export function evaluateDisciplineGate(input: DisciplineGateInput): DisciplineGateResult {
  if (!input.strictModeEnabled) return { allowed: true, checks: [] };
  const checks: DisciplineCheck[] = [];
  if (input.requirePretradePlan) checks.push(evaluatePretradePlan(input));
  if (input.sopCheckEnabled) checks.push(evaluateBuiltinSop(input));
  if (input.personalSopCheckEnabled) checks.push(evaluatePersonalSop(input));
  return {
    allowed: !checks.some((check) => check.status === "blocked"),
    checks,
  };
}
