# Native Windows Control Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 BAT/PowerShell 控制面板收敛为一个可直接双击的原生 WinForms EXE，隐藏托管 Node 服务的终端窗口，并保留托盘常驻、状态查看、后台 worker 和开机启动能力。

**Architecture:** 原生 EXE 只负责 UI、托盘、子进程生命周期和轻量 HTTP 状态读取；数据更新继续由 `web/local-data/background-worker.mjs` 执行。EXE 只结束自己创建的子进程，能够附着到已存在的健康服务。BAT 只作为兼容转发层，启动项直接指向 EXE。

**Tech Stack:** .NET Framework WinForms / 系统 `csc.exe`、Node.js、现有 Vinext WebUI、Node test runner。

**Spec:** `docs/superpowers/specs/2026-08-23-native-control-panel-design.md`

## Global Constraints

- 保留当前工作区中与本任务无关的用户改动，不执行 reset、checkout、clean 或提交。
- 不修改数据库 schema、迁移策略、快照格式、交易执行规则、快捷键行为或数据供应商语义。
- 原生 UI 不导入数据库运行时，不调用 `getRawDb`、`ensureSchema`，不复制后台更新逻辑。
- 不让 UI feature 直接绕过现有服务 API；面板只访问现有健康/状态 HTTP 端点。
- 用户正常入口必须是 EXE；BAT 和旧 PowerShell 仅可作为兼容或诊断文件。
- 所有测试先写失败断言，再写实现；每个任务完成后运行该任务列出的局部验证。
- 不自动提交或推送 Git。

## Task 1: 建立原生进程托管核心与契约测试

**Files:** `launcher/NativeProcessSupervisor.cs`, `launcher/NativeControlPanel.cs`, `web/tests/native-launcher-contract.test.mjs`

- [ ] 先在 `web/tests/native-launcher-contract.test.mjs` 写失败测试：源文件存在；编译目标是 WinForms；使用 `UseShellExecute = false`、`CreateNoWindow = true` 和标准输出重定向；引用 `background-worker.mjs`、3100/3101/3102；不得启动 `powershell.exe` 或 `KLineControlPanel.ps1`。
- [ ] 实现 `NativeProcessSupervisor`：解析项目根目录和 Node 命令，创建数据服务、WebUI、worker 三个隐藏子进程，捕获 stdout/stderr，使用线程安全队列把日志交给 UI 线程，并只记录自己创建的进程。
- [ ] 实现健康探测和停止逻辑：使用现有 `/health`、WebUI 首页和 worker `/status`；停止时仅对自己创建的根 PID 使用 `taskkill /T /F`，不按端口杀进程。
- [ ] 运行 `node --test web/tests/native-launcher-contract.test.mjs`，确认核心契约通过；用系统 `csc.exe` 编译一次源文件，确认 .NET Framework 引用完整。

## Task 2: 实现单实例 WinForms UI、托盘和后台状态展示

**Files:** `launcher/NativeControlPanel.cs`, `web/tests/native-launcher-contract.test.mjs`

- [ ] 先补充失败测试：存在 `Application.Run`、`NotifyIcon`、命名 Mutex/事件、`--hidden` 处理、Startup 快捷方式目标是 EXE、只读日志控件、WebUI 打开入口和 worker 状态读取。
- [ ] 实现 WinForms 面板：显示数据服务、WebUI、后台 worker 三张状态卡，显示“当前后台工作”和脱敏只读日志；提供启动、停止、重启、打开 WebUI 按钮。
- [ ] 实现托盘行为：关闭/最小化隐藏到托盘，托盘双击恢复；菜单提供显示、打开 WebUI、重启服务和退出；命名 Mutex 保证只有一个 EXE 实例，重复启动只唤醒已有实例。
- [ ] 实现开机启动复选框：在当前用户 Startup 创建/删除快捷方式，目标为 `Application.ExecutablePath`，参数为 `--hidden`；读取现有快捷方式同步勾选状态。
- [ ] 实现启动顺序：先启动/探测数据服务和 WebUI，再启动 worker；启动后自动做一次轻量状态检查，但不在 UI 线程执行数据库任务。
- [ ] 运行局部契约测试，并用编译后的 EXE 做手工可重复冒烟：双击、隐藏到托盘、托盘恢复、打开 WebUI、退出。

## Task 3: 打包为直接入口并收敛兼容启动链

**Files:** `launcher/build-native-control-panel.ps1`, `启动控制面板.bat`, `启动本地网页版.bat`, `README.md`, `web/README.md`, `docs/architecture/smoke-checklist.md`

- [ ] 先补充失败测试：构建脚本输出项目根目录 EXE；两个 BAT 不再直接引用 PowerShell，且兼容入口最终只启动 EXE；文档主入口指向 EXE。
- [ ] 实现可重复构建脚本：调用系统 .NET Framework `csc.exe` 编译 WinForms 源文件到 `KLineTrainingCamp.ControlPanel.exe`，失败时返回非零退出码。
- [ ] 修改 BAT 为兼容转发器，清晰提示缺少 EXE 时先运行构建脚本；不改变现有 WebUI 端口和 worker 端口。
- [ ] 更新 README 和冒烟清单，说明 EXE、托盘、开机启动、同日一次和 worker 状态的验证方式。
- [ ] 执行构建脚本并确认 EXE 生成；用 `Start-Process` 启动一次，确认进程类型为 WinForms、无新 PowerShell/cmd 可见窗口、服务状态可达；结束测试进程树并保留用户原有服务。

## Final Verification

- [ ] 运行 `node --check` 覆盖受影响的 `.mjs` 文件。
- [ ] 运行 `npm run typecheck`。
- [ ] 运行 `npm run lint`。
- [ ] 运行 `npm run test:unit`。
- [ ] 运行 `npm run build`。
- [ ] 运行 `npm run verify`。
- [ ] 运行 `npm test`。
- [ ] 运行 `git diff --check`。
- [ ] 运行 `codegraph sync` 和 `codegraph status`，复查原生入口与 worker 的影响范围。
- [ ] 请求一次独立代码审查；修复审查发现的问题后重复相关验证。

