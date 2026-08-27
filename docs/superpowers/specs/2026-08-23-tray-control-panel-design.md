# 托盘控制面板与后台更新设计

## 目标

把当前的 Windows 启动 BAT 升级为一个独立的本机控制面板：面板常驻系统托盘，能够启动、停止和观察 Web 服务、本机行情服务及后台任务；用户可以从面板打开 WebUI，并可以选择随 Windows 开机在后台启动。

每日自动检查和更新不再依赖浏览器打开。它由独立 Node worker 在本机后台执行，数据库写入仍通过现有 Web 服务端 API 完成；WebUI 只做训练操作、状态展示和现有的手动数据管理，不承担每日任务调度。

## 范围

- 新增 Windows 原生托盘控制面板，不引入 Electron、Tauri 或新的 npm 运行时依赖。
- 新增本机后台 worker，负责每日自动更新的调度、任务编排、状态和结构化日志。
- 继续使用现有 3100 本机行情服务和 3101 Web 服务。
- 为后台 worker 增加仅监听 `127.0.0.1:3102` 的状态接口。
- 将每日自动更新从 `DataAutoUpdateController` 的浏览器 `useEffect` 迁移到后台 worker。
- 保留现有自动更新设置、任务表、数据源凭证和 API 响应结构；不修改数据库 schema、迁移、快照格式或供应商语义。
- 保留 `启动本地网页版.bat` 作为兼容入口，使其打开新的控制面板。

## 非目标

- 第一阶段不把所有手动数据导入、初始化、删除和维护操作改造成新的队列系统；这些操作仍由现有 API 执行，浏览器只发起请求并轮询服务端状态。
- 不增加 Windows 服务、计划任务服务账号、系统级安装器或公网控制接口。
- 不自动打开公网端口，不保存或显示供应商 Token/Secret。
- 不改变训练、交易、快照、快捷键、行情标准化和数据供应商业务规则。

## 架构

```text
启动控制面板.bat
        ↓
launcher/KLineControlPanel.ps1
        ├─ node local-data/server.mjs       :3100
        ├─ npm run dev                       :3101
        └─ node local-data/background-worker.mjs :3102
                                                   ↓
                                      http://127.0.0.1:3101/api/*
                                                   ↓
                                      Web 服务端、D1、本机行情服务
```

### 托盘面板

面板使用 Windows PowerShell 5.1 自带的 `System.Windows.Forms` 和 `NotifyIcon`。它只负责进程生命周期、健康检查、状态展示、日志聚合、开机启动项和打开 WebUI，不直接读写 D1 或供应商凭证。

面板启动时按以下顺序工作：

1. 检查 Node.js、npm、Web 项目目录和依赖；缺少依赖时在日志区执行现有 `npm install`。
2. 检查 3100；如果已经是本项目本机行情服务则接管显示，否则启动 `node local-data/server.mjs`。
3. 启动 `npm run dev`，等待 3101 返回健康页面。
4. 启动后台 worker，等待 3102 健康接口。

面板保存由自己启动的进程对象和 PID。停止时只终止已确认由本面板启动的进程树；已存在的外部服务只做观察，不强制结束。进程输出通过 stdout/stderr 事件汇总到带来源标签的控制台，并限制内存中的日志长度；长期日志写入用户本地 AppData 目录，不进入仓库。

关闭窗口只隐藏到托盘。托盘菜单提供显示面板、打开 WebUI、重启服务和退出并停止本面板进程。默认手动启动会显示面板；开机启动使用隐藏参数，不打开控制台和浏览器。

### 后台 worker

`web/local-data/background-worker.mjs` 只绑定 `127.0.0.1:3102`，不直接导入 Cloudflare worker 的 D1 runtime。它通过 3101 的现有 API 调用数据库和本机行情服务，因此所有重型数据库逻辑仍集中在现有服务端边界。

worker 提供：

- `GET /health`：进程和 Web API 依赖是否可用。
- `GET /status`：当前阶段、市场、任务进度、最近结果、错误摘要和更新时间。
- `POST /shutdown`：面板退出时请求 worker 停止调度并干净退出。

worker 的业务编排从浏览器控制器迁移而来，按现有顺序执行 A 股、美股和外汇任务，复用现有 API 的任务状态、暂停/恢复和持久化语义。日志只记录时间、阶段、品种、计数和错误摘要，禁止记录凭证。

## 每日调度与一致性

每日任务沿用“启动后检查一次、同一天只运行一次”的语义：

1. worker 启动后读取 `/api/data-auto-update` 设置；关闭时保持空闲。
2. 开启时按运行软件这台机器的系统本地时间和日期，通过现有 claim 接口申请当天运行权。
3. claim 成功后检查已有市场，依次执行 A 股每日维护、美股批次同步和到期外汇任务。
4. 任务完成后通过现有 complete 接口写入 `completed`、`partial` 或 `failed` 及摘要。
5. worker 每几分钟只做一次轻量日期检查，跨到新日期后才再次申请任务。

自动 claim 的同日规则调整为：当天已经有终态记录时不再自动 claim；仍在运行且超过租约的旧记录可以被新 worker 接管，以恢复断电或进程崩溃留下的状态。这样浏览器刷新、面板重启和多次启动都不会重复执行当天自动任务。

## WebUI 边界

- 删除 `TrainingWorkbench` 对 `DataAutoUpdateController` 的挂载，避免页面加载触发后台任务。
- `ProviderSettingsPanel` 继续显示自动更新开关和结果，并用低频只读轮询刷新后台 worker 写入的状态。
- 其他数据页继续使用已有 API 执行用户主动发起的操作；这些操作的数据库代码仍在服务端，不进入浏览器计算线程。
- 现有“数据变更后刷新品种目录/覆盖范围”的事件监听不再依赖自动更新控制器；页面通过现有状态轮询和视图加载刷新展示。

## 开机启动

“开机后台启动”在当前用户的 Windows Startup 目录创建或删除一个幂等 `.lnk`。快捷方式以隐藏参数启动 `启动控制面板.bat`/PowerShell 面板，面板进入托盘并按正常顺序拉起三个本地进程。取消开机启动只删除本项目创建的快捷方式，不影响其他启动项。

## 错误与恢复

- Node/npm 缺失、依赖安装失败、项目目录缺失、端口冲突和健康检查超时均显示在面板控制台，并保留可重试入口。
- 3100 如果返回的服务标识或版本不匹配，视为冲突，不停止未知进程。
- Web 服务暂不可用时，worker 进入等待状态并周期性重试依赖检查；不提交完成状态。
- 自动更新某个市场失败时继续处理后续市场，最后记录 `partial` 或 `failed`，并显示失败摘要。
- 停止面板不会把未完成任务伪造为成功；现有任务状态保留，下一次启动按服务端任务状态继续或恢复。
- 面板和 worker 的所有网络接口只绑定回环地址，不能从局域网或公网控制本机进程。

## 文件职责

- `启动本地网页版.bat`：兼容入口，转交新的控制面板并保留本地/局域网/远程地址提示语义。
- `启动控制面板.bat`：隐藏 PowerShell 控制台并启动面板脚本。
- `launcher/KLineControlPanel.ps1`：WinForms 窗口、托盘菜单、进程启动/停止、健康检查、日志和 Startup 快捷方式。
- `web/local-data/background-auto-update.mjs`：可测试的每日任务编排、API 客户端、日期门禁和状态转换。
- `web/local-data/background-worker.mjs`：worker HTTP 接口、调度 timer、进程信号处理和编排器组装。
- `web/app/lib/dataAutoUpdateSettings.ts`：调整同日终态不可重复 claim 的纯逻辑。
- `web/app/components/TrainingWorkbench.tsx`：移除浏览器自动更新挂载。
- `web/app/features/market-data/components/ProviderSettingsPanel.tsx`：增加只读状态轮询。
- `web/tests/background-auto-update.test.mjs`：worker 编排、日期和 API 顺序测试。
- `web/tests/data-auto-update.test.mjs`、`web/tests/mobile-ui.test.mjs`：更新同日 claim 和浏览器解耦断言。

## 验收与验证

- Node 单元测试覆盖：禁用时不运行、同日终态不重复 claim、并发 claim 只有一个成功、CN/US/FX 顺序、部分失败完成、旧 running 租约恢复以及凭证不进入日志。
- PowerShell 脚本进行语法解析验证，并用无 GUI 的辅助参数验证 Startup 快捷方式创建/删除逻辑。
- 启动面板后确认 3100、3101、3102 均健康，控制台能区分三个进程，点击按钮能打开 `http://localhost:3101`。
- 关闭 WebUI 页面后，后台 worker 仍能执行已开启的每日任务；重新打开 WebUI 只能看到任务状态，不会创建第二次当天任务。
- 按项目要求运行受影响测试、`npm run typecheck`、`npm run lint`、`npm run test:unit`、`npm run build`、`npm run verify`、`npm test`、`git diff --check`，并更新/复查 CodeGraph。
