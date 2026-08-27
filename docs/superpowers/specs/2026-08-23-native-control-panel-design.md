# 原生单 EXE 控制面板设计

## 背景

当前控制面板由 BAT 启动 PowerShell WinForms。虽然已经具备托盘、状态卡片和后台 worker，但 BAT/PowerShell 启动链仍可能让用户看到多个终端图标，且 PowerShell 的后台事件回调曾造成启动后闪退。用户需要一个可以直接双击的独立 Windows 程序。

## 目标

- 提供一个原生 WinForms 单 EXE 入口，用户不需要通过 BAT 启动。
- 程序启动后自动托管本地数据服务、WebUI 和后台 worker；子进程不显示终端窗口。
- 面板可显示三个服务状态、当前后台任务和只读日志，并能打开 WebUI。
- 面板关闭时隐藏到系统托盘并继续运行；托盘菜单可重新打开、打开 WebUI、重启服务和退出。
- 支持“开机启动”，启动项直接指向 EXE，并以隐藏到托盘的参数启动。
- 保持“启动后检查一次、同一天只运行一次”的任务语义。重型数据库工作仍只由现有 background worker 执行，面板只读取健康状态和 worker 状态。
- BAT 仅保留为兼容入口，并转发到 EXE；正常使用路径不再启动 BAT 或 PowerShell。

## 非目标

- 不修改数据库 schema、迁移策略、快照格式、交易执行规则或数据供应商语义。
- 不在原生 UI 中直接导入数据库运行时，也不把更新逻辑复制到桌面程序。
- 不引入 Electron、Tauri、服务端口代理或新的全局状态层。
- 不删除现有 PowerShell 控制面板文件；它作为诊断/回退代码保留，但不再是默认入口。

## 方案

### 入口与进程模型

`KLineTrainingCamp.ControlPanel.exe` 使用 .NET Framework WinForms 编译为 `winexe`。程序本身是唯一的用户可见窗口和任务栏图标，托管的 Node 进程使用重定向标准输出、隐藏窗口和无 Shell 启动方式运行。

EXE 内嵌多尺寸品牌图标，窗口标题栏和系统托盘从当前 EXE 读取同一图标；构造或项目目录解析失败时显示可见错误对话框，不再无提示闪退。

子进程分为三类：

1. `node local-data/server.mjs`，监听 `127.0.0.1:3100`。
2. `npm run dev`，运行 WebUI，监听 `3101`。
3. `node local-data/background-worker.mjs`，监听 `127.0.0.1:3102`。

启动前先用轻量健康检查识别已存在的服务；面板只记录自己创建的 `Process`，退出时只结束自己创建的进程树。唯一的启动恢复例外是：3101 返回异常且监听进程的命令行同时匹配当前项目 `web` 目录、`vinext dev` 和 `--port 3101` 时，将它视为本项目遗留 WebUI 并按精确 PID 回收。其他健康服务或身份不明的端口占用者一律不结束。

### 状态与日志

面板定时请求三个现有服务的健康/状态接口：

- 数据服务：`GET /health`。
- WebUI：请求首页，仅用于判断 WebUI 是否可访问。
- worker：`GET /health` 和 `GET /status`。

worker 返回的 `phase`、`taskId`、`market`、`message` 只用于展示，不由面板解释或执行。Node 子进程的 stdout/stderr 通过 C# 事件回调进入线程安全队列，UI 定时器在 UI 线程读取队列并显示脱敏后的最近日志。脱敏规则与现有本地 worker 保持同一原则，不展示 token、secret、api key、password 等敏感值。

### 托盘与单实例

程序使用命名 Mutex 保证只有一个面板实例。再次双击时通过命名事件通知现有实例显示窗口，而不是创建第二个图标。关闭窗口或最小化时隐藏到托盘；托盘双击恢复窗口。只有托盘菜单的“退出”才允许结束面板，退出时清理面板自己启动的子进程。

### 开机启动

面板在当前用户 Startup 目录创建 `KLineTrainingCamp.ControlPanel.lnk`。快捷方式目标是当前 EXE 的绝对路径，参数为 `--hidden`，工作目录是项目根目录。勾选状态从该快捷方式是否存在读取。创建或删除快捷方式失败时只在日志显示错误，不影响服务状态展示。

### 编译与兼容入口

仓库提供 `launcher/build-native-control-panel.ps1`，调用系统 .NET Framework `csc.exe` 编译源文件到项目根目录的 `KLineTrainingCamp.ControlPanel.exe`。它是构建脚本，不是用户启动入口。

`启动控制面板.bat` 改为只查找并启动该 EXE；`启动本地网页版.bat` 继续转发到前者。两者不再直接启动 PowerShell，避免用户从旧快捷方式再次进入旧启动链。

## 验收标准

- 双击项目根目录的 `KLineTrainingCamp.ControlPanel.exe` 后，任务栏只出现一个面板窗口图标；没有 cmd、PowerShell 或额外终端窗口。
- 面板启动后能显示 3100、3101、3102 的状态；WebUI 按钮能打开 `http://localhost:3101`。
- 面板关闭后只剩托盘图标，双击托盘图标能重新打开并看到最新状态。
- 勾选开机启动后，Startup 快捷方式目标为 EXE 且参数包含 `--hidden`；取消勾选会移除该快捷方式。
- 面板重启或重复启动不会重复执行同一天的数据库更新；该行为仍由 worker 和既有同日状态接口保证。
- `npm run verify`、`npm test`、`git diff --check` 通过；原生构建脚本可在当前 Windows 环境生成并运行 EXE。
