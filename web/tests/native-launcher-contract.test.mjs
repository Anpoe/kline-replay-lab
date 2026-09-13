import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("原生面板以隐藏子进程托管三个既有服务", async () => {
  const [supervisor, panel] = await Promise.all([
    readFile(new URL("../../launcher/NativeProcessSupervisor.cs", import.meta.url), "utf8"),
    readFile(new URL("../../launcher/NativeControlPanel.cs", import.meta.url), "utf8"),
  ]);
  const source = `${supervisor}\n${panel}`;

  assert.match(source, /System\.Windows\.Forms/);
  assert.match(source, /UseShellExecute\s*=\s*false/);
  assert.match(source, /CreateNoWindow\s*=\s*true/);
  assert.match(source, /RedirectStandardOutput\s*=\s*true/);
  assert.match(source, /RedirectStandardError\s*=\s*true/);
  assert.match(source, /background-worker\.mjs/);
  assert.match(source, /3100/);
  assert.match(source, /3101/);
  assert.match(source, /3102/);
  assert.doesNotMatch(source, /powershell\.exe/i);
  assert.doesNotMatch(source, /KLineControlPanel\.ps1/i);
});

test("原生面板提供单实例托盘 UI、隐藏启动与开机启动快捷方式", async () => {
  const source = await readFile(new URL("../../launcher/NativeControlPanel.cs", import.meta.url), "utf8");

  assert.match(source, /NotifyIcon/);
  assert.match(source, /new\s+Mutex\s*\(/);
  assert.match(source, /EventWaitHandle/);
  assert.match(source, /--hidden/);
  assert.match(source, /Application\.ExecutablePath/);
  assert.match(source, /Environment\.SpecialFolder\.Startup/);
  assert.match(source, /ReadOnly\s*=\s*true/);
  assert.match(source, /OpenWebUi/);
  assert.match(source, /GetWorkerStatusAsync/);
  assert.match(source, /BeginAction\(PanelAction\.Stop\)/);
  assert.match(source, /FormWindowState\.Minimized/);
  assert.match(source, /Application\.Run\s*\(/);
});

test("隐藏启动在首次可见前抑制窗口，但仍启动运行时", async () => {
  const source = await readFile(new URL("../../launcher/NativeControlPanel.cs", import.meta.url), "utf8");

  assert.match(source, /protected\s+override\s+void\s+SetVisibleCore\s*\(bool\s+value\)/);
  assert.match(source, /startHidden/);
  assert.match(source, /initialVisibilityAllowed/);
  assert.match(source, /BeginAction\(PanelAction\.Start\)/);
  assert.doesNotMatch(source, /Shown\s*\+=/);
});

test("隐藏启动先创建 HWND，再把运行时和唤醒监听投递到消息循环", async () => {
  const source = await readFile(new URL("../../launcher/NativeControlPanel.cs", import.meta.url), "utf8");

  assert.match(source, /if\s*\(startHidden\)\s*EnsureHiddenHandle\(\)/);
  assert.match(source, /CreateHandle\(\)/);
  assert.match(source, /HandleCreated\s*\+=/);
  assert.match(source, /QueueRuntimeStart/);
  assert.match(source, /BeginInvoke\(\(Action\)StartRuntime\)/);
  assert.match(source, /StartActivationListener\(\)/);
});

test("隐藏启动在构造期句柄已存在时仍由 OnLoad 补投递运行时", async () => {
  const source = await readFile(new URL("../../launcher/NativeControlPanel.cs", import.meta.url), "utf8");

  assert.match(source, /protected\s+override\s+void\s+OnLoad\s*\(EventArgs\s+e\)/);
  assert.match(source, /base\.OnLoad\(e\)[\s\S]{0,180}QueueRuntimeStart\(\)/);
  assert.match(source, /if\s*\(startHidden\)\s*EnsureHiddenHandle\(\)[\s\S]{0,180}QueueRuntimeStart\(\)/);
});

test("原生启动失败会同时写入状态和面板日志", async () => {
  const source = await readFile(new URL("../../launcher/NativeControlPanel.cs", import.meta.url), "utf8");

  assert.match(source, /RecordPanelLog\(/);
  assert.match(source, /RunActionAsync[\s\S]{0,1800}catch\s*\(Exception\s+error\)[\s\S]{0,260}RecordPanelLog/);
  assert.match(source, /QueueRuntimeStart[\s\S]{0,900}catch\s*\(Exception\s+error\)[\s\S]{0,260}RecordPanelLog/);
});

test("面板操作用单一闸门串行化，停止会取消排队中的启动", async () => {
  const [panel, supervisor] = await Promise.all([
    readFile(new URL("../../launcher/NativeControlPanel.cs", import.meta.url), "utf8"),
    readFile(new URL("../../launcher/NativeProcessSupervisor.cs", import.meta.url), "utf8"),
  ]);

  assert.match(panel, /SemaphoreSlim\s+actionGate/);
  assert.match(panel, /await\s+actionGate\.WaitAsync\(\)/);
  assert.match(panel, /operationVersion\s*!=\s*actionVersion/);
  assert.match(panel, /supervisor\.CancelPendingStarts\(\)/);
  assert.match(supervisor, /public\s+Task\[\]\s+CancelPendingStarts\s*\(/);
});

test("退出先异步确认停止自有进程，失败时不释放面板", async () => {
  const [panel, supervisor] = await Promise.all([
    readFile(new URL("../../launcher/NativeControlPanel.cs", import.meta.url), "utf8"),
    readFile(new URL("../../launcher/NativeProcessSupervisor.cs", import.meta.url), "utf8"),
  ]);

  assert.match(panel, /BeginShutdownAsync/);
  assert.match(panel, /RequestExit/);
  assert.match(panel, /await\s+supervisor\.StopAllOwnedAsync\(\)/);
  assert.match(panel, /supervisor\.HasOwnedProcesses/);
  assert.match(panel, /shutdownComplete/);
  assert.match(supervisor, /public\s+bool\s+HasOwnedProcesses/);
});

test("异步退出在释放操作闸门后才关闭窗体", async () => {
  const source = await readFile(new URL("../../launcher/NativeControlPanel.cs", import.meta.url), "utf8");

  assert.match(source, /actionGate\.Release\(\)[\s\S]{0,240}if\s*\(closeAfterShutdown\)\s*Close\(\)/);
  assert.doesNotMatch(source, /shutdownComplete\s*=\s*true;\s*Close\(\);[\s\S]{0,180}actionGate\.Release\(\)/);
});

test("系统或外部关闭不被托盘逻辑拦截，并在 FormClosed 尽力清理自有服务", async () => {
  const source = await readFile(new URL("../../launcher/NativeControlPanel.cs", import.meta.url), "utf8");
  const closing = source.slice(source.indexOf("private void HandleFormClosing"), source.indexOf("private void BeginShutdown"));
  const closed = source.slice(source.indexOf("private void HandleFormClosed"), source.indexOf("private void ApplyStartupShortcutState"));

  assert.match(closing, /eventArgs\.CloseReason\s*==\s*CloseReason\.UserClosing/);
  assert.match(closing, /CloseReason\.UserClosing[\s\S]{0,320}eventArgs\.Cancel\s*=\s*true[\s\S]{0,180}HideToTray/);
  assert.match(closing, /CloseReason\.UserClosing[\s\S]{0,500}PrepareForClose/);
  assert.match(source, /private void PrepareForClose[\s\S]{0,500}exitRequested\s*=\s*true[\s\S]{0,500}supervisor\.CancelPendingStarts/);
  assert.doesNotMatch(closing, /CloseReason\.(WindowsShutDown|TaskManagerClosing|ApplicationExitCall)[\s\S]{0,300}eventArgs\.Cancel\s*=\s*true/);
  assert.match(closed, /StopAllOwnedAsync/);
});

test("原生托管器序列化启动并在登记后才暴露子进程", async () => {
  const source = await readFile(new URL("../../launcher/NativeProcessSupervisor.cs", import.meta.url), "utf8");

  assert.match(source, /Dictionary<ManagedService,\s*Task>\s+startTasks/);
  assert.match(source, /startTasks\.TryGetValue\(service,\s*out\s+existingStart\)/);
  assert.match(source, /TaskCompletionSource<object>\s+completion/);
  assert.match(source, /startTasks\.Add\(service,\s*completion\.Task\)[\s\S]{0,320}StartCoreAsync\(service,\s*completion(?:,\s*[^)]*)?\)/);
  assert.match(source, /await ProbeAsync\(service\)\.ConfigureAwait\(false\);[\s\S]{0,160}ThrowIfDisposed\(\)/);
  assert.match(source, /ThrowIfDisposedLocked\(\)/);
  assert.match(source, /process\.Start\(\)[\s\S]{0,900}ownedProcesses\[service\]\s*=\s*managed[\s\S]{0,900}BeginOutputReadLine\(\)/);
  assert.match(source, /finally\s*\{[\s\S]{0,320}startTasks\.Remove\(service\)/);
});

test("原生托管器只在确认结束后释放所有权", async () => {
  const source = await readFile(new URL("../../launcher/NativeProcessSupervisor.cs", import.meta.url), "utf8");

  assert.doesNotMatch(source, /ownedProcesses\.Clear\(\)/);
  assert.match(source, /taskkill\.WaitForExit\(10000\)/);
  assert.match(source, /taskkill\.ExitCode\s*!=\s*0/);
  assert.match(source, /managed\.Process\.WaitForExit\(5000\)/);
  assert.match(source, /if\s*\(stopped\)[\s\S]{0,500}ownedProcesses\.Remove\(service\)/);
});

test("停止操作会取消未完成启动并有限重试自有进程树", async () => {
  const source = await readFile(new URL("../../launcher/NativeProcessSupervisor.cs", import.meta.url), "utf8");

  assert.match(source, /CancellationTokenSource\s+startCancellation/);
  assert.match(source, /CancelPendingStarts/);
  assert.match(source, /StopAllOwnedAsync/);
  assert.match(source, /Task\.WhenAll/);
  assert.match(source, /for\s*\(int\s+attempt\s*=\s*0;\s*attempt\s*<\s*2;/);
});

test("worker 在数据服务和 WebUI 健康后才启动", async () => {
  const source = await readFile(new URL("../../launcher/NativeProcessSupervisor.cs", import.meta.url), "utf8");

  assert.match(source, /WaitForHealthyAsync/);
  assert.match(source, /await\s+WaitForHealthyAsync\(ManagedService\.Data/);
  assert.match(source, /await\s+WaitForHealthyAsync\(ManagedService\.WebUi/);
  assert.match(source, /await\s+StartAsync\(ManagedService\.BackgroundWorker\)[\s\S]{0,180}await\s+WaitForHealthyAsync\(ManagedService\.BackgroundWorker/);
  assert.match(source, /Task\.Delay\(/);
  assert.match(source, /HealthWaitAttempts\s*=\s*60/);
  assert.match(source, /HealthWaitDelayMilliseconds\s*=\s*500/);
});

test("WebUI 健康检查必须匹配训练营页面标识", async () => {
  const source = await readFile(new URL("../../launcher/NativeProcessSupervisor.cs", import.meta.url), "utf8");
  const probe = source.slice(source.indexOf("private static bool IsExpectedResponse"), source.indexOf("private static string GetDetail"));

  assert.match(probe, /ManagedService\.WebUi[\s\S]{0,500}K线训练营 2\.0/);
  assert.match(probe, /StringComparison\.OrdinalIgnoreCase/);
  assert.doesNotMatch(probe, /if\s*\(service\s*==\s*ManagedService\.WebUi\)\s*return\s*!string\.IsNullOrWhiteSpace\(response\)/);
});

test("WebUI 子进程解析可执行 npm.cmd 并使用可执行的 cmd 参数", async () => {
  const source = await readFile(new URL("../../launcher/NativeProcessSupervisor.cs", import.meta.url), "utf8");

  assert.match(source, /ResolveNpmCommand\(\)/);
  assert.match(source, /KLINE_NPM_CMD/);
  assert.match(source, /startInfo\.FileName\s*=\s*string\.IsNullOrWhiteSpace\(commandShell\)\s*\?\s*"cmd\.exe"\s*:\s*commandShell/);
  assert.match(source, /startInfo\.Arguments\s*=\s*"\/d \/s \/c/);
  assert.match(source, /npmCommand/);
  assert.match(source, /npm\.cmd/);
  assert.match(source, /run dev -- --strictPort/);
});

test("正式发布包使用内置 Node 与打包 WebUI，并对缺少依赖给出可恢复提示", async () => {
  const source = await readFile(new URL("../../launcher/NativeProcessSupervisor.cs", import.meta.url), "utf8");

  assert.match(source, /release-manifest\.json/);
  assert.match(source, /ResolveNodeCommand[\s\S]{0,300}Path\.Combine\(root,\s*"runtime",\s*"node\.exe"\)/);
  assert.match(source, /Path\.Combine\(webDirectory,\s*"node_modules",\s*"vinext",\s*"dist",\s*"cli\.js"\)/);
  assert.match(source, /dev --hostname/);
  assert.match(source, /unzipper/);
  assert.match(source, /npm install/);
});

test("发布脚本构建生产包并排除个人开发文档", async () => {
  const script = await readFile(new URL("../../launcher/build-release.ps1", import.meta.url), "utf8");

  assert.match(script, /npm\.cmd/);
  assert.match(script, /['"]ci['"]/);
  assert.match(script, /['"]run['"][\s\S]{0,80}['"]build['"]/);
  assert.match(script, /\$stageRuntime\s*=\s*Join-Path\s+\$stageRoot\s+'runtime'/);
  assert.match(script, /\$stageRuntime[\s\S]{0,120}['"]node\.exe['"]/);
  assert.match(script, /-OutputPath/);
  assert.match(script, /\$releaseExcludedDirectories\s*=\s*@\(/);
  assert.match(script, /Join-Path\s+\$stageWeb\s+'\.wrangler'/);
  assert.match(script, /Join-Path\s+\$stageWeb\s+'\.local-data'/);
  assert.match(script, /release-manifest\.json/);
  assert.match(script, /AGENTS\.md/);
  assert.match(script, /docs/);
  assert.match(script, /\.zip/);
});

test("WebUI Vite 配置拒绝端口回退", async () => {
  const source = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");

  assert.match(source, /server\s*:\s*\{[\s\S]{0,1200}strictPort\s*:\s*true/);
});

test("原生托管器在日志进入队列前脱敏 JSON 和命令行凭据", async () => {
  const source = await readFile(new URL("../../launcher/NativeProcessSupervisor.cs", import.meta.url), "utf8");

  assert.match(source, /SensitiveValuePattern/);
  assert.match(source, /runToken/);
  assert.match(source, /api\[_-\]\?key/);
  assert.match(source, /credential/);
  assert.match(source, /RegexOptions\.IgnoreCase/);
  assert.match(source, /Redact\(message\)/);
  assert.match(source, /LogQueueLimit/);
});

test("原生控制面板由构建脚本输出为项目根目录 EXE", async () => {
  const source = await readFile(new URL("../../launcher/build-native-control-panel.ps1", import.meta.url), "utf8");

  assert.match(source, /KLineTrainingCamp\.ControlPanel\.exe/);
  assert.match(source, /NativeProcessSupervisor\.cs/);
  assert.match(source, /NativeControlPanel\.cs/);
  assert.match(source, /target:winexe/);
  assert.match(source, /csc\.exe/);
  assert.match(source, /exit\s+1/);
  assert.equal([...source].every((character) => character.codePointAt(0) <= 0x7f), true);
});

test("原生构建产物携带自定义图标而不是 Windows 默认应用图标", { skip: process.platform !== "win32" }, async () => {
  const buildScript = fileURLToPath(new URL("../../launcher/build-native-control-panel.ps1", import.meta.url));
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "kline-icon-test-"));
  try {
    const executable = join(temporaryDirectory, "KLineTrainingCamp.ControlPanel.exe");
    const build = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      buildScript,
      "-OutputPath",
      executable,
    ], { encoding: "utf8" });

    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    const baselineSource = join(temporaryDirectory, "NoIcon.cs");
    const baselineExecutable = join(temporaryDirectory, "NoIcon.exe");
    await writeFile(baselineSource, "using System; internal static class NoIcon { [STAThread] private static void Main() {} }", "utf8");
    const compilerCandidates = [
      join(process.env.WINDIR, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
      join(process.env.WINDIR, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
    ];
    const compiler = compilerCandidates.find(existsSync);
    assert.ok(compiler, "找不到 .NET Framework csc.exe");
    const baselineBuild = spawnSync(compiler, ["/nologo", "/target:winexe", `/out:${baselineExecutable}`, baselineSource], { encoding: "utf8" });
    assert.equal(baselineBuild.status, 0, `${baselineBuild.stdout}\n${baselineBuild.stderr}`);

    const compareIcons = String.raw`
Add-Type -AssemblyName System.Drawing
function Get-IconHash([System.Drawing.Icon] $Icon) {
  $bitmap = $Icon.ToBitmap()
  $stream = New-Object System.IO.MemoryStream
  try {
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToBase64String($sha.ComputeHash($stream.ToArray())) }
    finally { $sha.Dispose() }
  }
  finally {
    $stream.Dispose()
    $bitmap.Dispose()
  }
}
$custom = [System.Drawing.Icon]::ExtractAssociatedIcon($env:KLINE_ICON_TEST_EXE)
$baseline = [System.Drawing.Icon]::ExtractAssociatedIcon($env:KLINE_ICON_BASELINE_EXE)
if ($null -eq $custom -or $null -eq $baseline) { exit 2 }
try {
  if ((Get-IconHash $custom) -eq (Get-IconHash $baseline)) { exit 3 }
}
finally {
  $custom.Dispose()
  $baseline.Dispose()
}
`;
      const comparison = spawnSync("powershell.exe", ["-NoProfile", "-Command", compareIcons], {
        encoding: "utf8",
        env: {
          ...process.env,
          KLINE_ICON_TEST_EXE: executable,
          KLINE_ICON_BASELINE_EXE: baselineExecutable,
        },
      });

    assert.equal(comparison.status, 0, `${comparison.stdout}\n${comparison.stderr}`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("窗口和托盘复用 EXE 内嵌图标", async () => {
  const source = await readFile(new URL("../../launcher/NativeControlPanel.cs", import.meta.url), "utf8");

  assert.match(source, /Icon\.ExtractAssociatedIcon\(Application\.ExecutablePath\)/);
  assert.match(source, /trayIcon\s*=\s*new\s+NotifyIcon\s*\{\s*Icon\s*=\s*applicationIcon/);
  assert.doesNotMatch(source, /Icon\s*=\s*SystemIcons\.Application/);
});

test("WebUI 启动前只回收当前项目残留的 vinext 监听进程", async () => {
  const source = await readFile(new URL("../../launcher/NativeProcessSupervisor.cs", import.meta.url), "utf8");
  const recovery = source.slice(
    source.indexOf("private bool TryRecoverStaleWebUiProcess"),
    source.indexOf("private Process CreateServiceProcess"),
  );

  assert.match(source, /TryRecoverStaleWebUiProcess\(\)/);
  assert.match(recovery, /netstat\.exe/i);
  assert.match(recovery, /ManagementObjectSearcher/);
  assert.match(recovery, /webDirectory/);
  assert.match(recovery, /vinext/i);
  assert.match(recovery, /ManagedService\.WebUi/);
  assert.match(recovery, /TryStopProcessTree/);
  assert.match(recovery, /不属于当前项目/);
  assert.doesNotMatch(recovery, /ManagedService\.(Data|BackgroundWorker)[\s\S]{0,160}TryStopProcessTree/);
});

test("原生入口捕获初始化异常并显示可见错误", async () => {
  const source = await readFile(new URL("../../launcher/NativeControlPanel.cs", import.meta.url), "utf8");
  const entryPoint = source.slice(source.indexOf("public static void Main"), source.indexOf("private sealed class ServiceCard"));

  assert.match(entryPoint, /try\s*\{[\s\S]*Application\.Run/);
  assert.match(entryPoint, /catch\s*\(Exception\s+error\)/);
  assert.match(entryPoint, /MessageBox\.Show/);
  assert.match(entryPoint, /启动失败/);
});

test("旧 BAT 只兼容转发到原生 EXE，不再直接启动 PowerShell", async () => {
  const webBat = await readFile(new URL("../../启动本地网页版.bat", import.meta.url), "utf8");

  assert.match(webBat, /KLineTrainingCamp\.ControlPanel\.exe/i);
  assert.match(webBat, /\bstart\b/i);
  assert.match(webBat, /%\*/);
  assert.doesNotMatch(webBat, /powershell(?:\.exe)?/i);
  assert.doesNotMatch(webBat, /\bcall\b/i);
  assert.equal([...webBat].every((character) => character.codePointAt(0) <= 0x7f), true);
});

test("主文档将原生 EXE 说明为首选入口，并说明托盘和后台 worker 语义", async () => {
  const [rootReadme, webReadme, smokeChecklist] = await Promise.all([
    readFile(new URL("../../README.md", import.meta.url), "utf8"),
    readFile(new URL("../../web/README.md", import.meta.url), "utf8"),
    readFile(new URL("../../docs/architecture/smoke-checklist.md", import.meta.url), "utf8"),
  ]);

  for (const source of [rootReadme, webReadme, smokeChecklist]) {
    assert.match(source, /KLineTrainingCamp\.ControlPanel\.exe/);
  }
  assert.match(rootReadme, /系统托盘/);
  assert.match(rootReadme, /--hidden/);
  assert.match(rootReadme, /同一天不会/);
  assert.match(rootReadme, /worker/);
  assert.doesNotMatch(rootReadme, /控制面板还会显示局域网手机地址/);
  assert.match(webReadme, /从托盘选择“退出”/);
  assert.doesNotMatch(webReadme, /退出并停止服务/);
});
