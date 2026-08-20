# 测试、验证与协作规则

## 分层验证

### 修改前

1. 查看 `git status --short --branch`，保留用户已有改动。
2. 使用 CodeGraph 查询目标符号的调用者和影响范围；共享 `TrainingWorkbench.tsx` 的编辑必须串行。
3. 对新增可纯函数化的控制器先写行为测试，再实现生产逻辑；UI 迁移至少保留既有页面/渲染测试。

### 局部验证

根据改动范围运行：

- 控制器或纯逻辑：对应 `web/tests/*-controller.test.mjs` 和相关领域测试。
- TypeScript：`cd web; npm run typecheck`。
- Lint：`cd web; npm run lint`。
- 单元测试：`cd web; npm run test:unit`。
- 生产构建：`cd web; npm run build`。

### 全局验证

在一个 feature 完成、修复验证失败或准备交付时运行：

```text
cd web
npm run verify
npm test
```

`verify` 按 typecheck → lint → test:unit → build 顺序执行；现有 `test` 保持 build 加 Node 测试的兼容语义。不要把浏览器冒烟、数据库清理或真实外部同步接入默认验证链。

## CodeGraph 验证

索引必须保持最新。每次边界迁移前后至少复查：

- `codegraph status`
- `codegraph query TrainingWorkbench`
- `codegraph impact executeBarStep`
- `codegraph impact calculateDeterministicReviewMetrics`
- 对数据库入口需要时复查 `codegraph impact getRawDb` 和 `codegraph impact ensureSchema`
- 目标文件变化时使用 `codegraph affected <file...>` 或等价的受影响文件查询

对比调用者数量、关键边界和新增循环依赖；图谱变化只能由计划内的目录/导入调整解释。

## 冒烟验证

用户流程以 `docs/architecture/smoke-checklist.md` 为准。每项记录前置数据、操作、预期结果、请求边界和结果。迁移单个 feature 后复测受影响项，再在 Task 10 做全量复测。

涉及外部数据源时优先验证本地数据、错误展示和恢复入口。没有明确授权时，不执行真实同步、生产数据库写入或不可逆清理。

## 失败处理

- 任何验证失败先定位根因：代码回归、既有基线失败、环境依赖还是外部服务不可用。
- 能在当前范围修复就修复并重新跑局部与全局验证；不能修复则记录失败证据、影响范围和阻塞原因，不把失败带入下一项迁移。
- 不用跳过测试、放宽类型、屏蔽 lint 或修改业务断言来制造绿色结果。
- 完成声明必须有最新命令输出支持；至少确认 `npm run verify`、`npm test`、`git diff --check` 和 CodeGraph 状态。

## Agent 协作

- 并行 agent 只承担只读分析、独立文档或隔离 worktree 中的单一 feature；主 agent 负责合并、跨 feature 编辑和最终验证。
- 多个 agent 不得同时编辑 `TrainingWorkbench.tsx`、共享控制器契约或同一批 API 调用。
- 每个 agent 返回修改文件、验证命令、未解决风险和边界假设；审查 agent 只读检查，不直接覆盖主工作区改动。
- 不自动提交 Git。若需要 checkpoint，先由用户决定提交时机。
