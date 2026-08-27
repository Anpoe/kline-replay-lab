# 表现驱动个人 SOP 实施计划

> **For agentic workers:** 按任务逐项执行；每个任务先写失败测试，再写最小实现。共享 `TrainingWorkbench.tsx` 的编辑必须串行完成。不得自动提交或推送 Git。

**Goal:** 从表现分析中生成至少 15 笔样本的个人 SOP 候选，把全部可用指标纳入入场和持仓管理，并在严格模式下按现有订单/市场规则执行可审计的自动平仓。

**Architecture:** 继续采用模块化单体。统计推荐、SOP 纯检查和持仓年龄计算放在 `web/app/lib`；设置 feature 负责配置归一化和按钮开关；SOP 展示负责候选卡和采用回调；`TrainingWorkbench` 只串联当前训练上下文和既有执行引擎，不让 UI 直接访问数据库，也不复制撮合规则。

**Spec:** `docs/superpowers/specs/2026-08-21-performance-driven-personal-sop-design.md`

## 全局约束

- 候选组合至少 15 笔已平仓样本；现有分析卡的 2 笔探索门槛不作为个人 SOP 资格线。
- 入场条件和持仓管理分开检查；不只管理持仓根数。
- 保持数据库 schema、训练快照格式、API 外部契约、快捷键、数据供应商语义和执行引擎撮合规则不变。
- 自动平仓只在本地回放/模拟训练中工作；实盘观察只提示，不发送外部订单。
- 所有缺失当前资料的指标都返回“无法核验”而不是假设通过。
- `TrainingWorkbench.tsx` 是共享热状态入口，所有实际编辑串行执行。

## Task 1：个人 SOP 领域契约与统计推荐器

**Files:**

- Create: `web/app/lib/performanceSop.ts`
- Create: `web/tests/performance-sop.test.mjs`
- Modify: `web/app/lib/performance.ts` only when existing dimension helpers must be exported for one shared normalization path
- Modify: `web/tests/performance.test.mjs` only for compatibility assertions if shared output changes

**Implementation logic:**

- 定义可序列化的个人规则、候选、统计摘要、入场条件、资料条件和持仓管理条件。
- 从 `HabitTrade` 统一归一化市场/周期/品种、形态、市场状态、位置、理由、计划特征、价格/成交量/成交额/市值区间和持仓范围。
- 以市场 + 周期 + 品种范围先分组，以“形态 + 市场状态 + 位置 + 理由集合”作为基础语境；其他维度进入同一规则的条件证据，不因每个区间拆出过小样本。
- 固定导出 `MIN_PERSONAL_SOP_SAMPLES = 15`。补齐 14/15/16 笔、缺资料、负期望和多候选排序测试。
- 输出美股日线、A 股日线、FX 5 分钟的 scope 状态；缺样本时返回缺口，不跨 scope 借样本。
- 增加 `evaluatePersonalSopEntry`、`holdingBarsAtCursor` 和 `evaluatePersonalSopManagement` 纯函数。入口检查返回每个维度的状态，持仓检查只计算违规和动作意图，不创建 React 状态或订单。

**Verification:**

- 先运行 `node --test tests/performance-sop.test.mjs`，确认新测试因模块缺失而失败。
- 实现后运行该测试、`node --test tests/performance.test.mjs` 和 `npm run typecheck`。

## Task 2：设置持久化与独立纪律开关

**Files:**

- Modify: `web/app/features/settings/settingsContracts.ts`
- Modify: `web/app/features/settings/components/SettingsPanel.tsx`
- Modify: `web/app/features/settings/settingsController.ts` only for rule validation/normalization delegation
- Modify: `web/tests/settings-controller.test.mjs`
- Modify: `web/tests/settings-gateway.test.mjs` if persisted JSON compatibility needs coverage
- Modify: `web/app/globals.css`

**Implementation logic:**

- 在 `AppSettings` 增加严格模式、事前规划卡、选中字段、内置 SOP、个人表现 SOP、自动平仓和当前规则字段；所有默认值关闭且旧设置兼容。
- 把 `SettingsTab` 增加为交易纪律，使用滑块按钮开关；事前规划字段采用独立开关列表，关闭某字段就不再因为该字段为空阻断。
- 将内置 SOP 检查与个人表现 SOP 检查分开文案和状态；自动平仓只表达回放动作，不偷偷打开个人 SOP。
- 对激活规则做 JSON 形状和样本数归一化；不是候选资格的规则只能保留为 null。
- 新增测试覆盖旧设置回退、独立开关互不影响、字段选择和无效激活规则清除。

**Verification:**

- 先补充失败测试，再运行 `node --test tests/settings-controller.test.mjs tests/settings-gateway.test.mjs`。
- 实现后运行设置测试、`npm run typecheck`、`npm run lint`。

## Task 3：SOP 推荐卡与表现页入口

**Files:**

- Create: `web/app/features/sop/components/PersonalSopRecommendations.tsx`
- Create: `web/app/features/sop/sopContracts.ts` if the component needs a view-model boundary separate from the pure lib
- Modify: `web/app/components/TrainingWorkbench.tsx` (串行)
- Modify: `web/app/globals.css`
- Modify: `web/tests/rendered-html.test.mjs`
- Modify: `web/tests/mobile-ui.test.mjs` only for the added responsive selectors/labels

**Implementation logic:**

- 将所有已加载 session 的 habit trades 补充市场、周期和品种 scope，自动调用推荐器。
- 在表现页现有分析卡下增加“个人 SOP 推荐”区域，展示三类模板、最多三个候选、完整条件、全部管理指标、15 笔门槛、缺口和统计。
- 采用按钮调用 shell 回调，规范化后写入现有 settings gateway，并显示当前规则版本；不在候选计算时自动写设置。
- 当前筛选仍控制分析卡；SOP 推荐默认按全量可用历史分 scope，页面同时标明“全量历史”与当前筛选，避免误解口径。
- 不创建第二套数据请求；继续使用现有 session summary 和 snapshot context。

**Verification:**

- 先为推荐区域补页面静态断言，确认当前页面没有目标文案时失败。
- 实现后运行 rendered/mobile 测试、`npm run typecheck`、`npm run build`，并用浏览器确认桌面和窄屏候选卡可读、采用按钮可操作。

## Task 4：开仓 SOP 检查与事件记录

**Files:**

- Modify: `web/app/components/TrainingWorkbench.tsx` (串行)
- Modify: `web/app/lib/performanceSop.ts`
- Modify: `web/tests/performance-sop.test.mjs`
- Modify: `web/tests/rendered-html.test.mjs` if strict-mode status is rendered

**Implementation logic:**

- 在 `queueOpenOrder` 的现有市场规则检查前后接入纯函数 SOP 入口检查，传入当前决策、形态、价格和可用证券资料。
- 先执行事前规划卡字段检查，再按开关决定内置 SOP/个人 SOP；检查结果写入 `ruleNotice` 和审计事件，严格模式下只有启用的检查能阻断。
- 规则不在当前市场/周期/品种范围、形态/状态/位置/理由/计划条件不匹配时阻断；当前资料缺失只提示无法核验，不能假通过。
- 把纪律元数据附加到待成交订单和成交记录，仍使用 `executeBarStep` 的价格、资金、市场规则验证，不改变撮合算法。
- 开仓拒绝不能创建订单、不能扣资金、不能产生孤儿计划引用。

**Verification:**

- 先补 SOP gate 的通过、警告、阻断和开关独立性测试。
- 实现后运行 `node --test tests/performance-sop.test.mjs tests/execution-engine.test.mjs tests/rendered-html.test.mjs`。

## Task 5：持仓纪律提示与严格自动平仓

**Files:**

- Modify: `web/app/components/TrainingWorkbench.tsx` (串行)
- Modify: `web/app/lib/performanceSop.ts`
- Modify: `web/app/globals.css`
- Modify: `web/tests/performance-sop.test.mjs`
- Modify: `web/tests/execution-engine.test.mjs` only for metadata compatibility if required

**Implementation logic:**

- 在 `revealMany` 的本地模拟循环中，成交处理后用真实 bars 索引计算每个开放持仓的当前年龄。
- 只在个人 SOP 检查、严格模式和自动平仓均打开且当前规则有效时生成自动平仓委托；普通模式或关闭自动平仓只提示。
- 生成的委托沿用现有 close order 结构，填入个人规则 id/version/纪律原因；已有同仓平仓委托不重复生成。
- 当前 K 线不能卖出时调用已有 `findNextTradingSessionIndex` 和 `validateCloseOrder`，预约下一交易日；不能绕过 T+1 或其他交易约束。
- 订单进入待成交队列，按既有下一根开盘语义成交；在执行后记录自动平仓事件和规则快照摘要，并在持仓/委托列表显示纪律原因。
- 不在 training end 结算、止损止盈或保证金强平路径中复制个人 SOP 逻辑。

**Verification:**

- 先测试年龄边界：允许 3 根时第 3 根不触发、第 4 根触发；重复委托、T+1 锁定、无规则、开关关闭和训练结束边界。
- 实现后运行相关测试、`npm run typecheck`、`npm run lint`、`npm run build`。
- 浏览器回放一场模拟训练，确认提示、待成交平仓、下一根执行和审计事件可见。

## Task 6：整体验收与 CodeGraph 复查

**Files:**

- Modify: `docs/architecture/smoke-checklist.md`
- Modify: `docs/agents/domain-invariants.md` only to record the new non-bypass invariant if needed
- Modify: `web/app/components/TrainingWorkbench.tsx` only for final integration fixes

**Implementation logic:**

- 更新冒烟清单：表现页生成候选、14/15 门槛、采用规则、设置独立开关、严格开仓拦截、持仓超限提示、自动平仓、A 股 T+1 和规则关闭后的恢复。
- 重新同步 CodeGraph，复查 `TrainingWorkbench`、`executeBarStep`、`normalizeSettings`、推荐器和 SOP gate 的调用者/影响范围。
- 检查新增 feature 没有直接访问数据库、没有新增跨 feature 内部状态读取，也没有改变快照 schema。

**Verification:**

- `cd web; npm run verify`
- `cd web; npm test`
- `git diff --check`
- `codegraph status`
- `codegraph impact executeBarStep`
- `codegraph affected web/app/lib/performanceSop.ts web/app/features/settings/settingsContracts.ts web/app/components/TrainingWorkbench.tsx`
- 按 smoke checklist 做本地浏览器回归，不发起真实外部同步。

## 完成判定

- 所有局部和全局测试通过，构建成功，CodeGraph 为最新。
- 个人 SOP 推荐不会出现少于 15 笔的“可采用”组合。
- 规则详情能看到并检查持仓时长之外的所有可用指标。
- 自动平仓只通过既有订单/市场规则路径执行，关闭开关或不满足条件时不会产生隐式平仓。
- 不自动提交 Git；交付时报告修改文件和实际验证结果。
