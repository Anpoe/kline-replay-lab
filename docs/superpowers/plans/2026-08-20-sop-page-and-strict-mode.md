# SOP 页面与严格模式实施计划

> 目标：交付 SOP 页面、交易纪律设置和训练开仓门禁，不改变交易执行核心或持久化契约。

## 任务 1：建立纯 SOP 契约与门禁测试

- [ ] 新增 `web/app/features/sop/sopContracts.ts`，定义三个 SOP 版本、规则、样本和页面统计 DTO。
- [ ] 新增 `web/app/features/sop/sopController.ts`，实现市场/周期映射、样本聚合和严格模式门禁判断。
- [ ] 新增 `web/tests/sop-controller.test.mjs`，先覆盖严格模式关闭、规划卡缺失、SOP 字段缺失、通过、无适用版本和样本统计。
- [ ] 运行该测试确认先红，再实现到绿。

## 任务 2：接入设置模型与交易纪律 UI

- [ ] 在 `settingsContracts.ts` 增加三个严格模式字段、默认值和归一化规则。
- [ ] 在 `SettingsPanel.tsx` 增加“交易纪律”标签和三个独立开关，不改变现有设置 tab 行为。
- [ ] 扩展设置归一化测试，验证旧设置兼容和开关独立性。

## 任务 3：实现 SOP 页面

- [ ] 新增 `web/app/features/sop/components/SopPage.tsx`，展示版本卡、样本统计、规则详情、当前适用版本和严格模式状态。
- [ ] 在 `TrainingWorkbench.tsx` 增加 SOP 导航、页面数据 DTO 组装和历史训练加载入口。
- [ ] 在 `globals.css` 增加 SOP 页面和纪律设置的响应式样式。

## 任务 4：接入开仓门禁

- [ ] 在 `TrainingWorkbench.tsx` 的训练开仓入口调用纯门禁函数。
- [ ] 失败时复用现有拒单区域和事件审计；不修改 `executeBarStep`、订单结构或快照格式。
- [ ] 增加边界回归测试或在现有训练/渲染测试中覆盖 SOP 文案与入口。

## 任务 5：验证与交付

- [ ] 运行受影响测试。
- [ ] 运行 `npm run typecheck`、`npm run lint`、`npm run test:unit`、`npm run build`。
- [ ] 最终运行 `npm run verify`、兼容的 `npm test`、`git diff --check`，并用 CodeGraph 复查影响范围。
- [ ] 不提交、不推送 Git，交付改动摘要和验证结果。
