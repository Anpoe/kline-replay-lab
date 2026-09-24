# Settings feature

负责用户偏好、训练默认值、显示选项和偏好持久化的页面编排。

- UI 只展示和提交设置，不直接访问数据库或修改训练热状态。
- `settingsContracts.ts` 放稳定输入/输出类型。
- `settingsController.ts` 放可纯函数化的规范化和持久化适配逻辑。
- `settingsGateway.ts` 收口旧版 localStorage key、偏好清洗和 `/api/preferences` transport；交易理由和自定义形态预设以本地 D1 的同步偏好为唯一运行时来源，随机训练控制仍使用浏览器 localStorage，旧版交易理由/自定义预设键只用于一次性迁移。
- `components/` 放设置界面；Provider/行情供应商行为归属 market-data。

边界记录：

- 输入：当前设置草稿、训练模式需要的只读选项、可用品种/周期和设置页回调。
- 输出：规范化设置、校验错误和保存成功事件；保存后的训练视图更新仍由页面 shell 决定。
- 服务依赖：设置 UI 和训练 shell 只依赖可注入 gateway；live 字段仍由 live feature 管理，避免把实时模拟状态混入设置存储。
- 行为测试：`web/tests/settings-controller.test.mjs`、`web/tests/settings-gateway.test.mjs`、设置相关 `mobile-ui`/`rendered-html` 测试，以及 smoke checklist 的设置保存/刷新恢复项。
- 后续债务：继续把设置面板的副作用拆成可测试命令，并在页面级测试中覆盖远端 preferences 失败后的退避恢复。
