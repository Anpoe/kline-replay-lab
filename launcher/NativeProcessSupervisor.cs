using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace KLineTrainingCamp.Launcher
{
    public enum ManagedService
    {
        Data,
        WebUi,
        BackgroundWorker,
    }

    public sealed class ServiceHealth
    {
        public ManagedService Service { get; set; }
        public int Port { get; set; }
        public bool IsHealthy { get; set; }
        public bool IsOwned { get; set; }
        public int? ProcessId { get; set; }
        public string Detail { get; set; }
    }

    internal sealed class ManagedProcess
    {
        public ManagedService Service { get; set; }
        public Process Process { get; set; }
        public bool IsStopping { get; set; }
    }

    /// <summary>
    /// Owns child processes created by this executable. Healthy external services are left untouched;
    /// only an unhealthy project-local vinext listener on the reserved WebUI port is reclaimed.
    /// </summary>
    public sealed class NativeProcessSupervisor : IDisposable
    {
        public const int DataPort = 3100;
        public const int WebUiPort = 3101;
        public const int BackgroundWorkerPort = 3102;
        private const string ReleaseManifestFileName = "release-manifest.json";
        private const int HealthWaitAttempts = 60;
        private const int HealthWaitDelayMilliseconds = 500;
        private const int LogQueueLimit = 1000;
        private static readonly Regex SensitiveValuePattern = new Regex(
            "(?<prefix>[\\\"']?(?:token|runToken|secret|api[_-]?key|password|credential)[\\\"']?\\s*[:=]\\s*)(?<value>\\\"(?:\\\\.|[^\\\"])*\\\"|'(?:\\\\.|[^'])*'|[^\\s,}\\]]+)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private readonly object syncRoot = new object();
        private readonly Dictionary<ManagedService, ManagedProcess> ownedProcesses = new Dictionary<ManagedService, ManagedProcess>();
        private readonly Dictionary<ManagedService, Task> startTasks = new Dictionary<ManagedService, Task>();
        private readonly ConcurrentQueue<string> logQueue = new ConcurrentQueue<string>();
        private readonly string projectRoot;
        private readonly string webDirectory;
        private readonly string nodeCommand;
        private readonly bool packagedRelease;
        private CancellationTokenSource startCancellation = new CancellationTokenSource();
        private int queuedLogCount;
        private bool disposed;

        public NativeProcessSupervisor(string startingDirectory = null, string nodeExecutable = null)
        {
            projectRoot = FindProjectRoot(startingDirectory ?? AppDomain.CurrentDomain.BaseDirectory);
            webDirectory = Path.Combine(projectRoot, "web");
            string configuredNode = string.IsNullOrWhiteSpace(nodeExecutable)
                ? Environment.GetEnvironmentVariable("KLINE_NODE_EXE")
                : nodeExecutable;
            packagedRelease = File.Exists(Path.Combine(projectRoot, ReleaseManifestFileName));
            nodeCommand = ResolveNodeCommand(projectRoot, configuredNode, packagedRelease);
        }

        public string ProjectRoot { get { return projectRoot; } }

        public string WebDirectory { get { return webDirectory; } }

        public bool IsPackagedRelease { get { return packagedRelease; } }

        public bool HasOwnedProcesses
        {
            get
            {
                lock (syncRoot)
                {
                    RemoveExitedOwnedProcessesLocked();
                    return ownedProcesses.Count > 0;
                }
            }
        }

        public bool TryDequeueLog(out string line)
        {
            if (!logQueue.TryDequeue(out line)) return false;
            Interlocked.Decrement(ref queuedLogCount);
            return true;
        }

        public async Task StartAllAsync()
        {
            ThrowIfDisposed();
            await StartAsync(ManagedService.Data).ConfigureAwait(false);
            await WaitForHealthyAsync(ManagedService.Data, GetStartCancellationToken()).ConfigureAwait(false);
            await StartAsync(ManagedService.WebUi).ConfigureAwait(false);
            await WaitForHealthyAsync(ManagedService.WebUi, GetStartCancellationToken()).ConfigureAwait(false);
            await StartAsync(ManagedService.BackgroundWorker).ConfigureAwait(false);
            await WaitForHealthyAsync(ManagedService.BackgroundWorker, GetStartCancellationToken()).ConfigureAwait(false);
        }

        private async Task WaitForHealthyAsync(ManagedService service, CancellationToken cancellationToken)
        {
            for (int attempt = 0; attempt < HealthWaitAttempts; attempt++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                ServiceHealth health = await ProbeAsync(service).ConfigureAwait(false);
                if (health.IsHealthy) return;
                if (attempt + 1 < HealthWaitAttempts)
                    await Task.Delay(HealthWaitDelayMilliseconds, cancellationToken).ConfigureAwait(false);
            }
            throw new TimeoutException("服务未在限定时间内就绪：" + service + "。");
        }

        private CancellationToken GetStartCancellationToken()
        {
            lock (syncRoot) { return startCancellation.Token; }
        }

        public Task StartAsync(ManagedService service)
        {
            lock (syncRoot)
            {
                ThrowIfDisposedLocked();
                Task existingStart;
                if (startTasks.TryGetValue(service, out existingStart)) return existingStart;
                if (startCancellation.IsCancellationRequested)
                {
                    startCancellation.Dispose();
                    startCancellation = new CancellationTokenSource();
                }
                TaskCompletionSource<object> completion = new TaskCompletionSource<object>();
                startTasks.Add(service, completion.Task);
                Task ignored = StartCoreAsync(service, completion, startCancellation.Token);
                return completion.Task;
            }
        }

        private async Task StartCoreAsync(ManagedService service, TaskCompletionSource<object> completion, CancellationToken cancellationToken)
        {
            try
            {
                ServiceHealth health = await ProbeAsync(service).ConfigureAwait(false);
                cancellationToken.ThrowIfCancellationRequested();
                ThrowIfDisposed();
                if (health.IsHealthy)
                {
                    EnqueueLog(service, "已发现健康的现有服务，面板将附着但不会接管它。");
                    completion.TrySetResult(null);
                    return;
                }

                if (service == ManagedService.WebUi && TryRecoverStaleWebUiProcess())
                {
                    await Task.Delay(300, cancellationToken).ConfigureAwait(false);
                }

                lock (syncRoot)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    ThrowIfDisposedLocked();
                    ManagedProcess existing;
                    if (ownedProcesses.TryGetValue(service, out existing) && !existing.Process.HasExited)
                    {
                        EnqueueLog(service, "已由当前面板启动，等待健康检查。");
                        completion.TrySetResult(null);
                        return;
                    }

                    ValidateServicePrerequisites(service);
                    Process process = CreateServiceProcess(service);
                    var managed = new ManagedProcess { Service = service, Process = process };
                    bool started = false;
                    AttachOutput(service, process);
                    try
                    {
                        ThrowIfDisposedLocked();
                        if (!process.Start()) throw new InvalidOperationException("子进程未能启动。");
                        started = true;
                        ownedProcesses[service] = managed;
                        cancellationToken.ThrowIfCancellationRequested();
                        ThrowIfDisposedLocked();
                        process.BeginOutputReadLine();
                        process.BeginErrorReadLine();
                        EnqueueLog(service, "已启动隐藏子进程，PID " + process.Id + "。");
                    }
                    catch
                    {
                        if (!started)
                        {
                            process.Dispose();
                        }
                        else if (TryStopProcessTree(managed))
                        {
                            ownedProcesses.Remove(service);
                            process.Dispose();
                        }
                        else
                        {
                            EnqueueLog(service, "启动初始化失败，进程所有权已保留以便稍后重试停止。");
                        }
                        throw;
                    }
                }
                completion.TrySetResult(null);
            }
            catch (Exception error)
            {
                EnqueueLog(service, "启动失败：" + error.Message);
                completion.TrySetException(error);
            }
            finally
            {
                lock (syncRoot)
                {
                    startTasks.Remove(service);
                }
            }
        }

        public async Task<IList<ServiceHealth>> ProbeAllAsync()
        {
            var probes = new[]
            {
                ProbeAsync(ManagedService.Data),
                ProbeAsync(ManagedService.WebUi),
                ProbeAsync(ManagedService.BackgroundWorker),
            };
            ServiceHealth[] results = await Task.WhenAll(probes).ConfigureAwait(false);
            return results;
        }

        public async Task<ServiceHealth> ProbeAsync(ManagedService service)
        {
            string url = GetProbeUrl(service);
            try
            {
                string response = await ReadTextAsync(url).ConfigureAwait(false);
                bool healthy = IsExpectedResponse(service, response);
                ManagedProcess owned = GetOwnedProcess(service);
                return new ServiceHealth
                {
                    Service = service,
                    Port = GetPort(service),
                    IsHealthy = healthy,
                    IsOwned = owned != null,
                    ProcessId = owned == null ? (int?)null : owned.Process.Id,
                    Detail = healthy ? GetDetail(service, response) : "服务响应不符合预期。",
                };
            }
            catch (Exception error)
            {
                ManagedProcess owned = GetOwnedProcess(service);
                return new ServiceHealth
                {
                    Service = service,
                    Port = GetPort(service),
                    IsHealthy = false,
                    IsOwned = owned != null,
                    ProcessId = owned == null ? (int?)null : owned.Process.Id,
                    Detail = error.Message,
                };
            }
        }

        public async Task<string> GetWorkerStatusAsync()
        {
            try
            {
                return await ReadTextAsync("http://127.0.0.1:" + BackgroundWorkerPort + "/status").ConfigureAwait(false);
            }
            catch (Exception error)
            {
                return "后台任务未就绪：" + error.Message;
            }
        }

        public void StopAllOwned()
        {
            ThrowIfDisposed();
            StopAllOwnedCore();
        }

        public async Task<bool> StopAllOwnedAsync()
        {
            ThrowIfDisposed();
            Task[] pendingStarts = CancelPendingStarts();
            try
            {
                await Task.WhenAll(pendingStarts).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                EnqueueLog(ManagedService.BackgroundWorker, "已取消未完成的启动操作。");
            }
            catch (Exception error)
            {
                EnqueueLog(ManagedService.BackgroundWorker, "启动收尾失败，将继续停止已登记进程：" + error.Message);
            }
            await Task.Run(delegate { StopAllOwnedCore(); }).ConfigureAwait(false);
            return !HasOwnedProcesses;
        }

        public Task[] CancelPendingStarts()
        {
            lock (syncRoot)
            {
                startCancellation.Cancel();
                return new List<Task>(startTasks.Values).ToArray();
            }
        }

        private void StopAllOwnedCore()
        {
            ManagedService[] services;
            lock (syncRoot)
            {
                services = new List<ManagedService>(ownedProcesses.Keys).ToArray();
            }

            foreach (ManagedService service in services)
            {
                StopOwnedCore(service);
            }
        }

        public void StopOwned(ManagedService service)
        {
            ThrowIfDisposed();
            StopOwnedCore(service);
        }

        private void StopOwnedCore(ManagedService service)
        {
            ManagedProcess managed;
            lock (syncRoot)
            {
                if (!ownedProcesses.TryGetValue(service, out managed)) return;
                if (managed.IsStopping)
                {
                    EnqueueLog(service, "停止正在进行，保留进程所有权直到结果确认。");
                    return;
                }
                managed.IsStopping = true;
            }

            bool stopped = false;
            for (int attempt = 0; attempt < 2; attempt++)
            {
                stopped = TryStopProcessTree(managed);
                if (stopped) break;
                if (attempt < 1) Thread.Sleep(300);
            }
            lock (syncRoot)
            {
                managed.IsStopping = false;
                ManagedProcess current;
                if (!ownedProcesses.TryGetValue(service, out current) || !object.ReferenceEquals(current, managed)) return;
                if (stopped)
                {
                    ownedProcesses.Remove(service);
                }
            }
            if (stopped)
            {
                managed.Process.Dispose();
                EnqueueLog(service, "已确认结束当前面板创建的进程树。");
            }
        }

        public void Dispose()
        {
            lock (syncRoot)
            {
                if (disposed) return;
                RemoveExitedOwnedProcessesLocked();
                if (ownedProcesses.Count > 0 || startTasks.Count > 0)
                    throw new InvalidOperationException("必须先完成异步停止，才能释放进程托管器。");
                disposed = true;
                startCancellation.Cancel();
            }
            startCancellation.Dispose();
        }

        private bool TryRecoverStaleWebUiProcess()
        {
            if (GetOwnedProcess(ManagedService.WebUi) != null) return false;

            int? processId = FindListeningProcessId(WebUiPort);
            if (!processId.HasValue) return false;

            string processName;
            string commandLine;
            if (!TryReadProcessCommandLine(processId.Value, out processName, out commandLine))
            {
                EnqueueLog(ManagedService.WebUi, "端口 3101 已被 PID " + processId.Value + " 占用，但无法确认进程身份，未结束该进程。");
                return false;
            }

            string normalizedWebDirectory = Path.GetFullPath(webDirectory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string normalizedCommandLine = (commandLine ?? string.Empty).Replace('/', '\\');
            bool isNode = string.Equals(processName, "node.exe", StringComparison.OrdinalIgnoreCase)
                || string.Equals(processName, "node", StringComparison.OrdinalIgnoreCase);
            bool belongsToProject = normalizedCommandLine.IndexOf(normalizedWebDirectory, StringComparison.OrdinalIgnoreCase) >= 0;
            bool isVinextDevelopmentServer = normalizedCommandLine.IndexOf("vinext", StringComparison.OrdinalIgnoreCase) >= 0
                && Regex.IsMatch(normalizedCommandLine, @"(?:^|\s)dev(?:\s|$)", RegexOptions.IgnoreCase)
                && Regex.IsMatch(normalizedCommandLine, @"--port(?:\s+|=)3101(?:\s|$)", RegexOptions.IgnoreCase);

            if (!isNode || !belongsToProject || !isVinextDevelopmentServer)
            {
                EnqueueLog(ManagedService.WebUi, "端口 3101 已被 PID " + processId.Value + " 占用，但该进程不属于当前项目可回收的旧 WebUI，未结束该进程。");
                return false;
            }

            try
            {
                using (Process staleProcess = Process.GetProcessById(processId.Value))
                {
                    EnqueueLog(ManagedService.WebUi, "发现当前项目残留的旧 WebUI（PID " + processId.Value + "），正在回收后重新启动。");
                    var staleWebUi = new ManagedProcess { Service = ManagedService.WebUi, Process = staleProcess };
                    bool stopped = TryStopProcessTree(staleWebUi);
                    if (stopped) EnqueueLog(ManagedService.WebUi, "旧 WebUI 已回收，端口 3101 可重新使用。");
                    return stopped;
                }
            }
            catch (Exception error)
            {
                EnqueueLog(ManagedService.WebUi, "回收旧 WebUI 失败：" + error.Message);
                return false;
            }
        }

        private static int? FindListeningProcessId(int port)
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = "netstat.exe",
                Arguments = "-ano -p tcp",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };

            try
            {
                using (Process netstat = Process.Start(startInfo))
                {
                    if (netstat == null) return null;
                    string output = netstat.StandardOutput.ReadToEnd();
                    netstat.StandardError.ReadToEnd();
                    if (!netstat.WaitForExit(5000) || netstat.ExitCode != 0) return null;

                    foreach (string line in output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
                    {
                        string[] fields = Regex.Split(line.Trim(), @"\s+");
                        if (fields.Length < 5 || !string.Equals(fields[0], "TCP", StringComparison.OrdinalIgnoreCase)) continue;
                        if (!string.Equals(fields[3], "LISTENING", StringComparison.OrdinalIgnoreCase)) continue;
                        int separator = fields[1].LastIndexOf(':');
                        if (separator < 0) continue;
                        int parsedPort;
                        int parsedProcessId;
                        if (!int.TryParse(fields[1].Substring(separator + 1), out parsedPort) || parsedPort != port) continue;
                        if (int.TryParse(fields[4], out parsedProcessId) && parsedProcessId > 0) return parsedProcessId;
                    }
                }
            }
            catch
            {
                return null;
            }
            return null;
        }

        private static bool TryReadProcessCommandLine(int processId, out string processName, out string commandLine)
        {
            processName = null;
            commandLine = null;
            try
            {
                using (var searcher = new ManagementObjectSearcher(
                    "SELECT Name, CommandLine FROM Win32_Process WHERE ProcessId = " + processId))
                {
                    foreach (ManagementObject item in searcher.Get())
                    {
                        try
                        {
                            processName = Convert.ToString(item["Name"]);
                            commandLine = Convert.ToString(item["CommandLine"]);
                            return !string.IsNullOrWhiteSpace(processName) && !string.IsNullOrWhiteSpace(commandLine);
                        }
                        finally
                        {
                            item.Dispose();
                        }
                    }
                }
            }
            catch
            {
                return false;
            }
            return false;
        }

        private Process CreateServiceProcess(ManagedService service)
        {
            var startInfo = new ProcessStartInfo
            {
                WorkingDirectory = webDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };

            if (service == ManagedService.WebUi)
            {
                if (packagedRelease)
                {
                    startInfo.FileName = nodeCommand;
                    startInfo.Arguments = "node_modules\\vinext\\dist\\cli.js dev --hostname :: --port " + WebUiPort + " --strictPort";
                }
                else
                {
                    string commandShell = Environment.GetEnvironmentVariable("ComSpec");
                    startInfo.FileName = string.IsNullOrWhiteSpace(commandShell) ? "cmd.exe" : commandShell;
                    string npmCommand = ResolveNpmCommand();
                    startInfo.Arguments = "/d /s /c \"\"" + npmCommand + "\" run dev -- --strictPort\"";
                }
            }
            else
            {
                startInfo.FileName = nodeCommand;
                startInfo.Arguments = service == ManagedService.Data
                    ? "local-data\\server.mjs"
                    : "local-data\\background-worker.mjs";
            }

            if (service == ManagedService.BackgroundWorker)
            {
                startInfo.EnvironmentVariables["KLINE_BACKGROUND_HOST"] = "127.0.0.1";
                startInfo.EnvironmentVariables["KLINE_BACKGROUND_PORT"] = BackgroundWorkerPort.ToString();
                startInfo.EnvironmentVariables["KLINE_WEB_ORIGIN"] = "http://127.0.0.1:" + WebUiPort;
            }
            return new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        }

        private void ValidateServicePrerequisites(ManagedService service)
        {
            if (Path.IsPathRooted(nodeCommand) && !File.Exists(nodeCommand))
                throw new FileNotFoundException("找不到随发布包附带的 Node.js 运行时：" + nodeCommand + "。", nodeCommand);

            if (service == ManagedService.Data && !File.Exists(Path.Combine(webDirectory, "node_modules", "unzipper", "package.json")))
                throw new FileNotFoundException("缺少本地运行依赖 unzipper。开发目录请在 web 目录执行 npm install；正式发布包请重新解压完整安装包。", Path.Combine(webDirectory, "node_modules", "unzipper"));

            if (service == ManagedService.WebUi && packagedRelease)
            {
                string cliPath = Path.Combine(webDirectory, "node_modules", "vinext", "dist", "cli.js");
                string buildPath = Path.Combine(webDirectory, "dist", "server", "index.js");
                if (!File.Exists(cliPath) || !File.Exists(buildPath))
                    throw new FileNotFoundException("正式发布包缺少 WebUI 生产构建产物，请重新生成发布包。", buildPath);
            }
        }

        private static string ResolveNodeCommand(string root, string configuredNode, bool preferBundled)
        {
            string bundledNode = Path.Combine(root, "runtime", "node.exe");
            if (preferBundled) return bundledNode;
            if (!string.IsNullOrWhiteSpace(configuredNode)) return configuredNode;
            return File.Exists(bundledNode) ? bundledNode : "node.exe";
        }

        private string ResolveNpmCommand()
        {
            string configured = Environment.GetEnvironmentVariable("KLINE_NPM_CMD");
            if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured)) return configured;

            string nodeDirectory = null;
            try
            {
                if (Path.IsPathRooted(nodeCommand) && File.Exists(nodeCommand)) nodeDirectory = Path.GetDirectoryName(nodeCommand);
            }
            catch { }
            if (!string.IsNullOrWhiteSpace(nodeDirectory))
            {
                string sibling = Path.Combine(nodeDirectory, "npm.cmd");
                if (File.Exists(sibling)) return sibling;
            }

            string path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
            foreach (string directory in path.Split(Path.PathSeparator))
            {
                string trimmed = directory.Trim().Trim('"');
                if (string.IsNullOrWhiteSpace(trimmed)) continue;
                string candidate = Path.Combine(trimmed, "npm.cmd");
                if (File.Exists(candidate)) return candidate;
            }
            return "npm.cmd";
        }

        private void AttachOutput(ManagedService service, Process process)
        {
            process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args)
            {
                if (!string.IsNullOrWhiteSpace(args.Data)) EnqueueLog(service, args.Data);
            };
            process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs args)
            {
                if (!string.IsNullOrWhiteSpace(args.Data)) EnqueueLog(service, "错误：" + args.Data);
            };
            process.Exited += delegate
            {
                EnqueueLog(service, "子进程已退出。");
            };
        }

        private bool TryStopProcessTree(ManagedProcess managed)
        {
            try
            {
                if (managed.Process.HasExited)
                {
                    EnqueueLog(managed.Service, "子进程此前已退出，释放所有权。");
                    return true;
                }

                int pid = managed.Process.Id;
                var killer = new ProcessStartInfo
                {
                    FileName = "taskkill.exe",
                    Arguments = "/PID " + pid + " /T /F",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                using (Process taskkill = Process.Start(killer))
                {
                    if (taskkill == null)
                    {
                        EnqueueLog(managed.Service, "无法启动 taskkill，保留进程所有权。");
                        return false;
                    }
                    if (!taskkill.WaitForExit(10000))
                    {
                        EnqueueLog(managed.Service, "taskkill 超时，保留进程所有权以便重试。");
                        return false;
                    }
                    if (taskkill.ExitCode != 0 && !managed.Process.HasExited)
                    {
                        string standardError = taskkill.StandardError.ReadToEnd();
                        EnqueueLog(managed.Service, "taskkill 失败（退出码 " + taskkill.ExitCode + "）：" + standardError);
                        return false;
                    }
                }
                if (!managed.Process.WaitForExit(5000) && !managed.Process.HasExited)
                {
                    EnqueueLog(managed.Service, "taskkill 已返回，但根 PID " + pid + " 仍未退出；保留所有权以便重试。");
                    return false;
                }
                return true;
            }
            catch (Exception error)
            {
                EnqueueLog(managed.Service, "停止失败，已保留所有权：" + error.Message);
                return false;
            }
        }

        private ManagedProcess GetOwnedProcess(ManagedService service)
        {
            lock (syncRoot)
            {
                ManagedProcess managed;
                if (!ownedProcesses.TryGetValue(service, out managed)) return null;
                if (!managed.Process.HasExited) return managed;
                ownedProcesses.Remove(service);
                managed.Process.Dispose();
                return null;
            }
        }

        private void RemoveExitedOwnedProcessesLocked()
        {
            var exited = new List<ManagedService>();
            foreach (KeyValuePair<ManagedService, ManagedProcess> entry in ownedProcesses)
            {
                if (!entry.Value.Process.HasExited) continue;
                entry.Value.Process.Dispose();
                exited.Add(entry.Key);
            }
            foreach (ManagedService service in exited) ownedProcesses.Remove(service);
        }

        private static async Task<string> ReadTextAsync(string url)
        {
            return await Task.Run(delegate
            {
                var request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = "GET";
                request.Timeout = 2500;
                request.ReadWriteTimeout = 2500;
                using (var response = (HttpWebResponse)request.GetResponse())
                using (var stream = response.GetResponseStream())
                using (var reader = new StreamReader(stream, Encoding.UTF8))
                {
                    return reader.ReadToEnd();
                }
            }).ConfigureAwait(false);
        }

        private static bool IsExpectedResponse(ManagedService service, string response)
        {
            if (service == ManagedService.Data) return response.IndexOf("kline-local-data", StringComparison.OrdinalIgnoreCase) >= 0;
            if (service == ManagedService.BackgroundWorker) return response.IndexOf("kline-background-worker", StringComparison.OrdinalIgnoreCase) >= 0;
            if (service == ManagedService.WebUi)
            {
                return response.IndexOf("K线训练营 2.0", StringComparison.OrdinalIgnoreCase) >= 0
                    || response.IndexOf("KLineTrainingCamp", StringComparison.OrdinalIgnoreCase) >= 0;
            }
            return false;
        }

        private static string GetDetail(ManagedService service, string response)
        {
            if (service != ManagedService.BackgroundWorker) return "健康。";
            try
            {
                var serializer = new JavaScriptSerializer();
                var state = serializer.DeserializeObject(response) as Dictionary<string, object>;
                if (state == null) return "健康。";
                object message;
                return state.TryGetValue("message", out message) && message != null
                    ? Convert.ToString(message)
                    : "健康。";
            }
            catch
            {
                return "健康。";
            }
        }

        private static string GetProbeUrl(ManagedService service)
        {
            if (service == ManagedService.Data) return "http://127.0.0.1:" + DataPort + "/health";
            if (service == ManagedService.BackgroundWorker) return "http://127.0.0.1:" + BackgroundWorkerPort + "/health";
            return "http://127.0.0.1:" + WebUiPort + "/";
        }

        private static int GetPort(ManagedService service)
        {
            if (service == ManagedService.Data) return DataPort;
            if (service == ManagedService.BackgroundWorker) return BackgroundWorkerPort;
            return WebUiPort;
        }

        private static string FindProjectRoot(string startingDirectory)
        {
            string candidate = Path.GetFullPath(startingDirectory);
            while (!string.IsNullOrEmpty(candidate))
            {
                if (File.Exists(Path.Combine(candidate, "web", "package.json"))) return candidate;
                DirectoryInfo parent = Directory.GetParent(candidate);
                candidate = parent == null ? null : parent.FullName;
            }
            throw new DirectoryNotFoundException("找不到包含 web\\package.json 的项目根目录。");
        }

        private void EnqueueLog(ManagedService service, string message)
        {
            logQueue.Enqueue("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + service + " · " + Redact(message));
            int count = Interlocked.Increment(ref queuedLogCount);
            while (count > LogQueueLimit)
            {
                string discarded;
                if (!logQueue.TryDequeue(out discarded)) break;
                count = Interlocked.Decrement(ref queuedLogCount);
            }
        }

        private static string Redact(string value)
        {
            return string.IsNullOrEmpty(value) ? value : SensitiveValuePattern.Replace(value, RedactMatch);
        }

        private static string RedactMatch(Match match)
        {
            string hidden = "[hidden]";
            string originalValue = match.Groups["value"].Value;
            if (originalValue.StartsWith("\"", StringComparison.Ordinal)) hidden = "\"[hidden]\"";
            else if (originalValue.StartsWith("'", StringComparison.Ordinal)) hidden = "'[hidden]'";
            return match.Groups["prefix"].Value + hidden;
        }

        private void ThrowIfDisposed()
        {
            lock (syncRoot)
            {
                ThrowIfDisposedLocked();
            }
        }

        private void ThrowIfDisposedLocked()
        {
            if (disposed) throw new ObjectDisposedException("NativeProcessSupervisor");
        }
    }
}
