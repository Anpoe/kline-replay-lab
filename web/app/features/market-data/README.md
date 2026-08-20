# Market-data feature

负责数据源选择、覆盖范围、同步维护、供应商配置和标准化数据状态展示。

- 供应商原始响应和同步细节继续由现有 lib/service 负责。
- UI 通过 API 或父级适配器发起数据动作，不读取训练订单、回放游标或数据库 runtime。
- `marketDataContracts.ts` 放统一数据状态和 shell 通知类型。
- `marketDataController.ts` 放可纯函数化的动作/状态编排。
- `marketDataGateway.ts` 收口 provider 状态、下载/市场同步、本机数据任务、FX 任务、覆盖范围、快照和 onboarding storage；轮询节奏仍由宿主控制。

边界记录：

- 输入：当前市场、数据源状态、覆盖范围/同步任务状态、供应商配置和用户发起的数据维护动作。
- 输出：标准化市场数据状态、刷新通知、同步进度、用户可见错误和训练页重新加载信号。
- 服务依赖：组件只依赖可注入 gateway；provider 原始响应仍停留在 market-data 边界，训练核心只接收标准化目录、快照和刷新通知。
- 行为测试：`web/tests/market-data-controller.test.mjs`、`web/tests/market-data-gateway.test.mjs`、既有 FX/市场数据测试、移动端/渲染测试，以及 smoke checklist 的本地数据、维护和离线恢复项。
- 后续债务：把约 1,500 行的 `DataSourceManager` 按本地数据、下载任务、US 同步和 FX 任务协调拆分；本阶段先保持共享轮询行为稳定。
