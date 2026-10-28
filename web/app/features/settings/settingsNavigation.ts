import type { SettingsTab } from "./settingsContracts.ts";
import { shortcutActions } from "../../lib/keyboardShortcuts.ts";

export const settingsCategories = [
  { id: "basic", label: "图表与回放", hint: "显示时区、训练时段、周末、历史 K 线" },
  { id: "training", label: "随机训练", hint: "品种、周期、日期、训练范围、形态筛选" },
  { id: "accounts", label: "账户与资金", hint: "训练账户、实时模拟账户、外汇与黄金保证金" },
  { id: "orders", label: "下单与成交", hint: "默认数量、风险仓位、委托、佣金、滑点" },
  { id: "discipline", label: "交易纪律", hint: "严格模式、事前规划卡、内置与个人 SOP" },
  { id: "shortcuts", label: "快捷键", hint: "看盘、回放、交易、绘图、长按快进与快退" },
  { id: "mt4", label: "MT4", hint: "面板开关、图表开收盘波动窗口" },
  { id: "data", label: "数据", hint: "行情自动更新、定时检查、数据源连接凭证" },
  { id: "connections", label: "连接", hint: "手机访问、局域网、跨网络连接、设备配对与授权" },
  { id: "storage", label: "记录管理", hint: "训练回收站、恢复已删除训练" },
] as const satisfies readonly { id: SettingsTab; label: string; hint: string }[];

export const settingsGroups = [
  { id: "shortcuts", category: "shortcuts", title: "快捷键", keywords: `按键 键位 热键 长按 连续 快进 快退 keyboard shortcut ${shortcutActions.map(action => `${action.group} ${action.label} ${action.help}`).join(" ")}` },
  { id: "timezone", category: "basic", title: "图表显示时区", keywords: "市场时间 北京 纽约 伦敦 UTC 夏令时 A股 美股 外汇 黄金" },
  { id: "session", category: "basic", title: "训练时段", keywords: "交易时段 开始时间 结束时间 跨午夜 跳过 K线" },
  { id: "weekends", category: "basic", title: "周末处理", keywords: "自动跳过周末 周六 周日" },
  { id: "history", category: "basic", title: "历史 K 线", keywords: "图表左侧 新训练显示根数 回看" },
  { id: "training-account", category: "accounts", title: "训练模拟账户", keywords: "收益率模式 资金账户模式 新训练 初始资金 本金 风险计算基准" },
  { id: "live-account", category: "accounts", title: "实时模拟账户", keywords: "新账户默认配置 A股 美股 初始资金 风险计算基准 收益率模式 资金账户模式" },
  { id: "fx-account", category: "accounts", title: "外汇与黄金保证金", keywords: "账户币种 USD CNY EUR 杠杆 强平线 保证金水平 第三币种换算率" },
  { id: "quantity", category: "orders", title: "默认下单数量", keywords: "不同市场 手数 A股 美股 外汇 黄金 固定数量" },
  { id: "order-mode", category: "orders", title: "下单方式与风险", keywords: "默认开仓委托 市价 限价 止损 风险仓位 单笔风险 余额 百分比 固定数量" },
  { id: "execution", category: "orders", title: "成交与费用", keywords: "佣金 最低佣金 手续费 滑点 买卖价差 点差 单根成交量参与上限 同一根K线 同时触发 止损 止盈 优先" },
  { id: "random-instrument", category: "training", title: "品种范围", keywords: "固定当前品种 全部品种 指定市场 A股 纳入指数 只看盘 美股 流动性 最低20日平均成交额 美元" },
  { id: "random-dates", category: "training", title: "历史日期范围", keywords: "随机历史时间段 全部历史 指定时间段 开始日期 结束日期" },
  { id: "random-timeframe", category: "training", title: "时间周期", keywords: "固定当前周期 全部周期 指定周期 分钟 小时 日线 周线" },
  { id: "random-length", category: "training", title: "默认训练范围", keywords: "训练长度 揭示 K线 根数 不限" },
  { id: "pattern-scan", category: "training", title: "形态筛选", keywords: "扫描 相邻命中冷却K线数 随机训练最多检查候选数 趋势升幅 阈值" },
  { id: "strict", category: "discipline", title: "严格模式", keywords: "开仓门禁 交易纪律 规划 SOP 检查" },
  { id: "pretrade", category: "discipline", title: "事前规划卡", keywords: "必填 要求填写 入场理由 止损依据 目标依据 目标位置 计划仓位 风险收益比" },
  { id: "builtin-sop", category: "discipline", title: "内置 SOP", keywords: "基础SOP 市场 周期 检查" },
  { id: "personal-sop", category: "discipline", title: "个人表现 SOP", keywords: "当前规则 表现推荐 样本 持仓管理 超限自动平仓 只提示" },
  { id: "mt4-enabled", category: "mt4", title: "MT4 面板", keywords: "显示 MT4 面板 功能开关 导航 连接 EA" },
  { id: "mt4-motion", category: "mt4", title: "图表波动窗口", keywords: "仅显示开收盘波动 开盘后 收盘前 秒数 冻结 解冻 声音 提示音 试听" },
  { id: "providers", category: "data", title: "行情更新与数据连接", keywords: "每日启动自动检查更新 每日定时检查更新 每日检查时间 系统时间 服务地址 服务密钥 访问密钥 ID 连接凭证 日线 分钟 历史K线 不复权 前复权 内置 免费 Tushare Pro Alpaca TdxQuant BaoStock Dukascopy CSV A股 美股 外汇 黄金" },
  { id: "mobile-access", category: "connections", title: "手机访问", keywords: "移动版 Wi-Fi 无线 局域网 扫码 二维码 配对 设备 授权 防火墙 连接 手机 Tailscale HTTPS 远程 跨网络 流量" },
  { id: "trash", category: "storage", title: "训练回收站", keywords: "已删除训练 恢复 彻底删除 找回" },
] as const satisfies readonly { id: string; category: SettingsTab; title: string; keywords: string }[];

export type SettingsGroupId = typeof settingsGroups[number]["id"];

function normalizeSearch(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
}

/** A non-empty search spans every category; each term must match the same group. */
export function findSettingsGroups(query: string, category: SettingsTab) {
  const terms = query.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return settingsGroups.filter((group) => {
    if (!terms.length) return group.category === category;
    const categoryLabel = settingsCategories.find((item) => item.id === group.category)!.label;
    const text = normalizeSearch(`${categoryLabel} ${group.title} ${group.keywords}`);
    return terms.every((term) => text.includes(normalizeSearch(term)));
  });
}
