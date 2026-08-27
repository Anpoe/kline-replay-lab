using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using FormsTimer = System.Windows.Forms.Timer;

namespace KLineTrainingCamp.Launcher
{
    public sealed class NativeControlPanel : Form
    {
        private const string MutexName = "Local\\KLineTrainingCamp.NativeControlPanel";
        private const string ActivationEventName = "Local\\KLineTrainingCamp.NativeControlPanel.Activate";
        private const int LogBoxLimit = 50000;
        private readonly NativeProcessSupervisor supervisor;
        private readonly EventWaitHandle activationSignal;
        private readonly SemaphoreSlim actionGate = new SemaphoreSlim(1, 1);
        private readonly Dictionary<ManagedService, ServiceCard> serviceCards = new Dictionary<ManagedService, ServiceCard>();
        private readonly Icon applicationIcon;
        private readonly TextBox logBox;
        private readonly Label workerLabel;
        private readonly Label summaryLabel;
        private readonly CheckBox startupCheckBox;
        private readonly NotifyIcon trayIcon;
        private readonly FormsTimer logTimer;
        private readonly FormsTimer statusTimer;
        private readonly bool startHidden;
        private Thread activationThread;
        private long actionVersion;
        private bool initialVisibilityAllowed;
        private bool shuttingDown;
        private bool shutdownInProgress;
        private bool shutdownComplete;
        private bool exitRequested;
        private bool polling;
        private bool applyingStartupState;
        private bool runtimeStartQueued;
        private bool runtimeStarted;

        private enum PanelAction { Start, Stop, Restart }

        public NativeControlPanel(string[] args, EventWaitHandle sharedActivationSignal)
        {
            startHidden = HasHiddenArgument(args);
            activationSignal = sharedActivationSignal;
            supervisor = new NativeProcessSupervisor();
            Icon extractedIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            applicationIcon = extractedIcon == null ? (Icon)SystemIcons.Application.Clone() : (Icon)extractedIcon.Clone();
            if (extractedIcon != null) extractedIcon.Dispose();
            Text = "K线训练营 2.0 控制面板";
            ClientSize = new Size(850, 620);
            MinimumSize = new Size(760, 540);
            StartPosition = FormStartPosition.CenterScreen;
            Icon = applicationIcon;
            if (startHidden) ShowInTaskbar = false;

            var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 5, Padding = new Padding(16) };
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            Controls.Add(root);
            summaryLabel = new Label { AutoSize = true, Font = new Font(Font.FontFamily, 11.0f, FontStyle.Bold), Padding = new Padding(0, 0, 0, 8), Text = "正在准备本地服务…" };
            root.Controls.Add(summaryLabel, 0, 0);

            var cards = new TableLayoutPanel { AutoSize = true, Dock = DockStyle.Top, ColumnCount = 3, Margin = new Padding(0, 0, 0, 10) };
            cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.333f));
            cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.333f));
            cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.334f));
            AddServiceCard(cards, ManagedService.Data, "本地数据服务", NativeProcessSupervisor.DataPort, 0);
            AddServiceCard(cards, ManagedService.WebUi, "WebUI", NativeProcessSupervisor.WebUiPort, 1);
            AddServiceCard(cards, ManagedService.BackgroundWorker, "后台更新任务", NativeProcessSupervisor.BackgroundWorkerPort, 2);
            root.Controls.Add(cards, 0, 1);
            workerLabel = new Label { AutoSize = false, Dock = DockStyle.Top, Height = 46, BackColor = Color.FromArgb(242, 245, 249), Padding = new Padding(10), Text = "当前后台工作：等待状态检查…", Margin = new Padding(0, 0, 0, 10) };
            root.Controls.Add(workerLabel, 0, 2);

            var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Top, WrapContents = true, Margin = new Padding(0, 0, 0, 10) };
            actions.Controls.Add(CreateActionButton("启动服务", delegate { BeginAction(PanelAction.Start); }));
            actions.Controls.Add(CreateActionButton("停止服务", delegate { BeginAction(PanelAction.Stop); }));
            actions.Controls.Add(CreateActionButton("重启服务", delegate { BeginAction(PanelAction.Restart); }));
            actions.Controls.Add(CreateActionButton("打开 WebUI", OpenWebUi));
            startupCheckBox = new CheckBox { AutoSize = true, Margin = new Padding(18, 7, 0, 0), Text = "开机后后台启动" };
            startupCheckBox.CheckedChanged += delegate { UpdateStartupShortcut(); };
            actions.Controls.Add(startupCheckBox);
            root.Controls.Add(actions, 0, 3);

            logBox = new TextBox { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, WordWrap = false, BackColor = Color.White, Font = new Font(FontFamily.GenericMonospace, 9.0f), AccessibleName = "已脱敏运行日志" };
            root.Controls.Add(logBox, 0, 4);
            trayIcon = new NotifyIcon { Icon = applicationIcon, Text = "K线训练营 2.0 控制面板", Visible = true, ContextMenuStrip = CreateTrayMenu() };
            trayIcon.DoubleClick += delegate { RestoreFromTray(); };
            logTimer = new FormsTimer { Interval = 500 };
            logTimer.Tick += delegate { DrainLogs(); };
            statusTimer = new FormsTimer { Interval = 2000 };
            statusTimer.Tick += delegate { BeginStatusPoll(); };

            Resize += delegate { if (WindowState == FormWindowState.Minimized) HideToTray(); };
            FormClosing += HandleFormClosing;
            FormClosed += HandleFormClosed;
            HandleCreated += delegate { QueueRuntimeStart(); };
            if (startHidden) EnsureHiddenHandle();
            if (startHidden) QueueRuntimeStart();
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            if (!runtimeStarted) runtimeStartQueued = false;
            QueueRuntimeStart();
        }

        protected override void SetVisibleCore(bool value)
        {
            if (startHidden && !initialVisibilityAllowed && value)
            {
                base.SetVisibleCore(false);
                return;
            }
            base.SetVisibleCore(value);
        }

        private void EnsureHiddenHandle()
        {
            if (!IsHandleCreated) CreateHandle();
        }

        private void QueueRuntimeStart()
        {
            if (runtimeStartQueued || runtimeStarted || IsDisposed || !IsHandleCreated) return;
            runtimeStartQueued = true;
            try
            {
                BeginInvoke((Action)StartRuntime);
            }
            catch (Exception error)
            {
                runtimeStartQueued = false;
                RecordPanelLog("ERROR", "运行时启动调度失败：" + error.Message);
            }
        }

        private void StartRuntime()
        {
            if (IsDisposed || runtimeStarted) return;
            runtimeStartQueued = false;
            runtimeStarted = true;
            try
            {
                ApplyStartupShortcutState();
                StartActivationListener();
                logTimer.Start();
                statusTimer.Start();
                BeginAction(PanelAction.Start);
            }
            catch (Exception error)
            {
                RecordPanelLog("ERROR", "运行时启动失败：" + error.Message);
                summaryLabel.Text = "运行时启动失败：" + error.Message;
            }
        }

        private void RecordPanelLog(string level, string message)
        {
            if (string.IsNullOrWhiteSpace(message)) return;
            string line = "[" + DateTime.Now.ToString("HH:mm:ss") + "] [" + level + "] [panel] " + message;
            Action append = delegate
            {
                if (logBox == null || logBox.IsDisposed) return;
                if (logBox.TextLength > LogBoxLimit) logBox.Text = logBox.Text.Substring(logBox.TextLength - (LogBoxLimit / 2));
                logBox.AppendText(line + Environment.NewLine);
                logBox.SelectionStart = logBox.TextLength;
                logBox.ScrollToCaret();
            };
            try
            {
                if (IsHandleCreated && InvokeRequired) BeginInvoke(append);
                else append();
            }
            catch
            {
                // The form may be closing while a startup failure is reported.
            }
        }

        private void AddServiceCard(TableLayoutPanel parent, ManagedService service, string name, int port, int column)
        {
            var card = new Panel { Dock = DockStyle.Fill, Height = 100, BackColor = Color.FromArgb(242, 245, 249), Margin = new Padding(column == 0 ? 0 : 5, 0, column == 2 ? 0 : 5, 0), Padding = new Padding(10) };
            var title = new Label { AutoSize = true, Dock = DockStyle.Top, Font = new Font(Font.FontFamily, 9.5f, FontStyle.Bold), Text = name + " · " + port };
            var status = new Label { AutoSize = false, Dock = DockStyle.Fill, ForeColor = Color.DimGray, Padding = new Padding(0, 8, 0, 0), Text = "正在检查…" };
            card.Controls.Add(status); card.Controls.Add(title); parent.Controls.Add(card, column, 0);
            serviceCards.Add(service, new ServiceCard(status));
        }

        private static Button CreateActionButton(string text, Action action)
        {
            var button = new Button { AutoSize = true, Text = text, UseVisualStyleBackColor = true };
            button.Click += delegate { action(); };
            return button;
        }

        private ContextMenuStrip CreateTrayMenu()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("显示控制面板", null, delegate { RestoreFromTray(); });
            menu.Items.Add("打开 WebUI", null, delegate { OpenWebUi(); });
            menu.Items.Add("重启服务", null, delegate { BeginAction(PanelAction.Restart); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出", null, delegate { RequestExit(); });
            return menu;
        }

        private void RequestExit()
        {
            exitRequested = true;
            Close();
        }

        private void BeginAction(PanelAction action)
        {
            Task ignored = RunActionAsync(action);
        }

        private async Task RunActionAsync(PanelAction action)
        {
            long operationVersion = Interlocked.Increment(ref actionVersion);
            if (action == PanelAction.Stop) supervisor.CancelPendingStarts();
            await actionGate.WaitAsync();
            try
            {
                if (operationVersion != actionVersion || shuttingDown) return;
                if (action == PanelAction.Start) await StartServicesAsync();
                else if (action == PanelAction.Stop) await StopServicesAsync();
                else
                {
                    bool stopped = await StopServicesAsync();
                    if (!stopped || operationVersion != actionVersion || shuttingDown) return;
                    await StartServicesAsync();
                }
            }
            catch (Exception error)
            {
                RecordPanelLog("ERROR", "操作失败：" + error.Message);
                if (operationVersion == actionVersion && !shuttingDown) summaryLabel.Text = "操作失败：" + error.Message;
            }
            finally { actionGate.Release(); }
            if (!shuttingDown) await PollStatusAsync();
        }

        private async Task StartServicesAsync()
        {
            summaryLabel.Text = "正在启动本地服务…";
            await supervisor.StartAllAsync();
            summaryLabel.Text = "本地服务已启动，后台任务仅通过本地 worker 执行。";
        }

        private async Task<bool> StopServicesAsync()
        {
            summaryLabel.Text = "正在取消启动并停止本面板创建的服务…";
            bool stopped = await supervisor.StopAllOwnedAsync();
            summaryLabel.Text = stopped ? "已停止本面板创建的服务；外部已运行服务不会被结束。" : "仍有本面板创建的服务未停止，请重试。";
            return stopped;
        }

        private void BeginStatusPoll()
        {
            Task ignored = PollStatusAsync();
        }

        private async Task PollStatusAsync()
        {
            if (polling || shuttingDown || IsDisposed) return;
            polling = true;
            try
            {
                IList<ServiceHealth> health = await supervisor.ProbeAllAsync();
                string workerStatus = await supervisor.GetWorkerStatusAsync();
                if (shuttingDown || IsDisposed) return;
                bool allHealthy = true;
                foreach (ServiceHealth item in health)
                {
                    ServiceCard card;
                    if (!serviceCards.TryGetValue(item.Service, out card)) continue;
                    card.Status.Text = item.IsHealthy ? "运行中 · " + item.Detail : "未就绪 · " + item.Detail;
                    card.Status.ForeColor = item.IsHealthy ? Color.FromArgb(31, 117, 69) : Color.FromArgb(161, 63, 53);
                    allHealthy = allHealthy && item.IsHealthy;
                }
                workerLabel.Text = "当前后台工作：" + FormatWorkerStatus(workerStatus);
                if (allHealthy) summaryLabel.Text = "所有本地服务均可访问；WebUI 只负责显示状态。";
            }
            catch (Exception error) { if (!shuttingDown) summaryLabel.Text = "状态检查失败：" + error.Message; }
            finally { polling = false; }
        }

        private static string FormatWorkerStatus(string rawStatus)
        {
            try
            {
                var status = new JavaScriptSerializer().DeserializeObject(rawStatus) as Dictionary<string, object>;
                if (status == null) return rawStatus;
                object message; object phase; object market;
                status.TryGetValue("message", out message); status.TryGetValue("phase", out phase); status.TryGetValue("market", out market);
                string text = message == null ? "等待任务。" : Convert.ToString(message);
                if (phase != null && !string.IsNullOrWhiteSpace(Convert.ToString(phase))) text += "（" + Convert.ToString(phase) + "）";
                if (market != null && !string.IsNullOrWhiteSpace(Convert.ToString(market))) text += " · " + Convert.ToString(market);
                return text;
            }
            catch { return rawStatus; }
        }

        private void DrainLogs()
        {
            string line;
            while (supervisor.TryDequeueLog(out line))
            {
                if (logBox.TextLength > LogBoxLimit) logBox.Text = logBox.Text.Substring(logBox.TextLength - (LogBoxLimit / 2));
                logBox.AppendText(line + Environment.NewLine);
            }
        }

        private void OpenWebUi()
        {
            try { Process.Start(new ProcessStartInfo { FileName = "http://127.0.0.1:" + NativeProcessSupervisor.WebUiPort + "/", UseShellExecute = true }); }
            catch (Exception error) { summaryLabel.Text = "无法打开 WebUI：" + error.Message; }
        }

        private void HideToTray()
        {
            Hide(); ShowInTaskbar = false;
        }

        private void RestoreFromTray()
        {
            if (IsDisposed) return;
            initialVisibilityAllowed = true;
            ShowInTaskbar = true; Show(); WindowState = FormWindowState.Normal; Activate(); BringToFront();
        }

        private void HandleFormClosing(object sender, FormClosingEventArgs eventArgs)
        {
            if (eventArgs.CloseReason == CloseReason.UserClosing)
            {
                if (!exitRequested) { eventArgs.Cancel = true; HideToTray(); return; }
                if (!shutdownComplete) { eventArgs.Cancel = true; BeginShutdown(); }
                return;
            }
            PrepareForClose();
        }

        private void PrepareForClose()
        {
            exitRequested = true;
            shuttingDown = true;
            Interlocked.Increment(ref actionVersion);
            supervisor.CancelPendingStarts();
            logTimer.Stop(); statusTimer.Stop(); trayIcon.Visible = false;
        }

        private void BeginShutdown()
        {
            Task ignored = BeginShutdownAsync();
        }

        private async Task BeginShutdownAsync()
        {
            if (shutdownInProgress || shutdownComplete) return;
            shutdownInProgress = true;
            PrepareForClose();
            await actionGate.WaitAsync();
            bool closeAfterShutdown = false;
            try
            {
                bool stopped = await supervisor.StopAllOwnedAsync();
                if (!stopped || supervisor.HasOwnedProcesses)
                {
                    shuttingDown = false; trayIcon.Visible = true; logTimer.Start(); statusTimer.Start();
                    summaryLabel.Text = "退出前未能停止全部自有服务，请从托盘再次点击退出重试。";
                    return;
                }
                shutdownComplete = true;
                closeAfterShutdown = true;
            }
            catch (Exception error)
            {
                shuttingDown = false; trayIcon.Visible = true; logTimer.Start(); statusTimer.Start();
                summaryLabel.Text = "退出前停止服务失败：" + error.Message;
            }
            finally { shutdownInProgress = false; actionGate.Release(); }
            if (closeAfterShutdown) Close();
        }

        private void HandleFormClosed(object sender, FormClosedEventArgs eventArgs)
        {
            PrepareForClose();
            try { supervisor.StopAllOwnedAsync().GetAwaiter().GetResult(); } catch { }
            if (activationSignal != null) activationSignal.Set();
            if (activationThread != null && activationThread.IsAlive) activationThread.Join(500);
            try { if (!supervisor.HasOwnedProcesses) supervisor.Dispose(); } catch { }
            trayIcon.Dispose();
            applicationIcon.Dispose();
        }

        private void ApplyStartupShortcutState()
        {
            applyingStartupState = true; startupCheckBox.Checked = IsStartupShortcutEnabled(); applyingStartupState = false;
        }

        private void UpdateStartupShortcut()
        {
            if (applyingStartupState) return;
            try
            {
                if (startupCheckBox.Checked)
                {
                    Type shellType = Type.GetTypeFromProgID("WScript.Shell"); dynamic shell = Activator.CreateInstance(shellType); dynamic shortcut = shell.CreateShortcut(StartupShortcutPath);
                    shortcut.TargetPath = Application.ExecutablePath; shortcut.Arguments = "--hidden"; shortcut.WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory; shortcut.Description = "K线训练营 2.0 控制面板"; shortcut.Save();
                }
                else if (File.Exists(StartupShortcutPath)) File.Delete(StartupShortcutPath);
            }
            catch (Exception error)
            {
                applyingStartupState = true; startupCheckBox.Checked = IsStartupShortcutEnabled(); applyingStartupState = false;
                summaryLabel.Text = "更新开机启动失败：" + error.Message;
            }
        }

        private static bool IsStartupShortcutEnabled()
        {
            try
            {
                if (!File.Exists(StartupShortcutPath)) return false;
                dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")); dynamic shortcut = shell.CreateShortcut(StartupShortcutPath);
                return string.Equals((string)shortcut.TargetPath, Application.ExecutablePath, StringComparison.OrdinalIgnoreCase) && string.Equals((string)shortcut.Arguments, "--hidden", StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
        }

        private static string StartupShortcutPath { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "K线训练营 2.0 控制面板.lnk"); } }

        private void StartActivationListener()
        {
            if (activationSignal == null) return;
            activationThread = new Thread(new ThreadStart(delegate
            {
                while (!shuttingDown)
                {
                    if (!activationSignal.WaitOne()) continue;
                    if (shuttingDown || IsDisposed) return;
                    try { BeginInvoke((Action)RestoreFromTray); } catch (InvalidOperationException) { return; }
                }
            }));
            activationThread.IsBackground = true; activationThread.Name = "KLineControlPanelActivation"; activationThread.Start();
        }

        private static bool HasHiddenArgument(string[] args)
        {
            if (args == null) return false;
            foreach (string arg in args) if (string.Equals(arg, "--hidden", StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        [STAThread]
        public static void Main(string[] args)
        {
            try
            {
                bool createdNew;
                using (var instanceMutex = new Mutex(true, MutexName, out createdNew))
                using (var activationEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ActivationEventName))
                {
                    if (!createdNew) { activationEvent.Set(); return; }
                    Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
                    Application.Run(new NativeControlPanel(args, activationEvent));
                }
            }
            catch (Exception error)
            {
                MessageBox.Show(
                    "K线训练营控制面板启动失败。\r\n\r\n" + error.Message +
                    "\r\n\r\n请确认程序仍位于 K线训练营2.0 项目目录中，然后重新启动。",
                    "K线训练营 2.0 · 启动失败",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }

        private sealed class ServiceCard { public ServiceCard(Label status) { Status = status; } public Label Status { get; private set; } }
    }
}
