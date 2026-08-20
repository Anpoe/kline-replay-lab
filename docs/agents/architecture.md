# 架构边界与依赖方向

## 总体形态

项目保持模块化单体：一个 Web 应用、现有 API 路由、现有数据服务和现有数据库运行时共同部署。feature 目录用于表达职责边界，不代表独立进程或独立数据库。

## 允许的依赖方向

```text
页面入口 / TrainingWorkbench
    ↓ 组合与跨 feature 事件
features/training
    ↓ 训练上下文与页面级回调
features/settings      features/market-data
features/review        features/live
    ↓ 稳定的纯逻辑、类型和服务适配入口
web/app/lib
    ↓ 现有 API / service / DB runtime
服务端 API 路由 → 现有数据服务 → web/db/runtime.ts
```

具体规则如下：

- `features/training` 可以组合其他 feature，但其他 feature 不得反向 import `TrainingWorkbench` 或读取训练页面内部状态。
- `features/settings` 负责偏好、训练模式、显示选项和设置持久化编排；它可以接收只读训练上下文，但不能修改回放游标、订单、持仓或资金。
- `features/market-data` 负责数据源选择、覆盖范围、同步维护、供应商配置和标准化数据状态；供应商原始响应不得传入训练核心。
- `features/review` 负责会话历史、快照恢复请求和绩效展示；恢复结果通过契约返回页面 shell，由训练核心决定如何应用。
- `features/live` 负责扫描条件、扫描结果、刷新/失败状态和结果选择；结果跳转通过页面 shell 事件完成，不直接改变回放、订单或持仓。
- feature 可以依赖 `web/app/lib` 中稳定的纯逻辑和既有服务入口，但 feature 之间不通过组件实例、页面内部状态或隐式全局变量通信。
- UI feature 只通过既有 API 或父级提供的适配器访问服务端，不直接依赖 `web/db/runtime.ts`、`getRawDb` 或 `ensureSchema`。
- `web/app/lib/executionEngine.ts`、`web/app/components/KLineReplayChart.tsx`、`web/db/runtime.ts` 在 Phase 1 中视为稳定依赖，不做核心重写。

## 状态归属

热状态包括回放游标、当前行情窗口、订单/持仓、权益、播放控制、图表交互和训练命令。它们留在训练核心或其明确的 shell 协调层。

冷状态包括偏好、数据维护进度、历史列表、复盘筛选、扫描结果和错误展示。它们优先由对应 feature 内部拥有，通过输入/输出契约与 shell 交互。

`SyncedPreferences` 中可能同时存在设置、扫描和导航恢复字段。迁移时按字段职责拆分读取和写入边界，不能把实时状态误归入普通设置，也不能改变已有接口字段。

## 禁止事项

- 不为了行数指标拆分没有独立输入、输出和行为测试的薄包装层。
- 不从 review、live 或 settings 直接调用训练核心内部函数来“方便”共享状态。
- 不在本阶段修改 API 外部响应契约、数据库 schema/迁移、快照格式、交易撮合规则、数据供应商语义或快捷键行为。
- 不把 feature 边界误解为微服务边界；禁止新增网络 hop、消息总线或独立部署单元。

## 变更前后检查

每次边界变更前后，对目标符号和文件运行 CodeGraph `status`、`query`、`callers`、`callees`、`impact` 或 `affected`。重点复查 `TrainingWorkbench`、`executeBarStep`、`calculateDeterministicReviewMetrics`、`getRawDb` 和 `ensureSchema`，确认没有新增反向依赖或数据库入口泄漏。
