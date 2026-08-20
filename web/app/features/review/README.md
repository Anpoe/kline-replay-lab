# Review feature

负责会话历史、筛选、快照恢复入口和绩效复盘展示。

- 只通过 sessions/snapshots/analysis API 或父级适配器读取数据。
- 恢复请求以标准化事件交给 training shell，不直接写回放、订单或持仓状态。
- 指标公式继续复用现有 `web/app/lib/reviewMetrics.ts`。
- `reviewContracts.ts` 和 `reviewController.ts` 分别承载边界类型与纯逻辑。
- `reviewGateway.ts` 收口 sessions、trash、snapshot restore 和 snapshot analysis transport；恢复结果仍交回 training shell。

边界记录：

- 输入：标准化会话摘要、复盘会话、筛选条件、确定性指标、快照恢复和证据查看回调。
- 输出：筛选后的历史列表、复盘展示模型、恢复请求、证据查看事件和规范化错误；训练 shell 负责实际恢复顺序。
- 服务依赖：展示组件和控制器不直接访问 API、数据库或训练热状态；shell 只注入 gateway，并负责把恢复结果转换成训练上下文。
- 行为测试：`web/tests/review-controller.test.mjs`、`web/tests/review-gateway.test.mjs`、`web/tests/review-metrics.test.mjs`、既有快照/会话测试和 smoke checklist 的保存、历史、复盘、恢复项。
- 后续债务：把页面级恢复失败、回收站回滚和快照缺失场景补成浏览器自动化测试。
