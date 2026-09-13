using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace KLineTrainingCamp.Launcher
{
    public sealed class ReleaseUpdateInfo
    {
        public string CurrentVersion { get; set; }
        public string LatestVersion { get; set; }
        public string AssetName { get; set; }
        public string DownloadUrl { get; set; }
        public string Sha256 { get; set; }
        public string ReleaseUrl { get; set; }
        public string ReleaseNotes { get; set; }
    }

    public sealed class NativeUpdateService
    {
        public const string Repository = "Anpoe/kline-replay-lab";
        public const string LatestReleaseApiUrl = "https://api.github.com/repos/Anpoe/kline-replay-lab/releases/latest";
        private const string UserAgent = "KLineTrainingCamp-Updater";
        private const string PortableAssetPrefix = "KLineTrainingCamp-Portable-";
        private const int NetworkTimeoutMilliseconds = 30000;
        private const int CopyBufferSize = 64 * 1024;
        private const string ControlPanelExecutableName = "KLineTrainingCamp.ControlPanel.exe";
        private static readonly Regex VersionPattern = new Regex(
            "^(?<version>\\d+\\.\\d+\\.\\d+(?:\\.\\d+)?)",
            RegexOptions.Compiled);
        private static readonly Regex Sha256Pattern = new Regex(
            "^[0-9a-fA-F]{64}$",
            RegexOptions.Compiled);

        private readonly string projectRoot;
        private readonly bool packagedRelease;

        public NativeUpdateService(string projectRoot, bool packagedRelease)
        {
            this.projectRoot = Path.GetFullPath(projectRoot);
            this.packagedRelease = packagedRelease;
            InstalledVersion = ReadInstalledVersion(this.projectRoot);
        }

        public bool IsPackagedRelease { get { return packagedRelease; } }

        public string InstalledVersion { get; private set; }

        public Task<ReleaseUpdateInfo> CheckForUpdateAsync(CancellationToken cancellationToken)
        {
            if (!packagedRelease) return Task.FromResult<ReleaseUpdateInfo>(null);
            return Task.Run(delegate
            {
                return CheckForUpdate(cancellationToken);
            }, cancellationToken);
        }

        public Task<string> DownloadPackageAsync(ReleaseUpdateInfo update, CancellationToken cancellationToken)
        {
            if (update == null) throw new ArgumentNullException("update");
            return Task.Run(delegate
            {
                string directory = Path.Combine(
                    Path.GetTempPath(),
                    "KLineTrainingCamp.Update." + Guid.NewGuid().ToString("N"));
                string packagePath = Path.Combine(directory, update.AssetName);
                try
                {
                    Directory.CreateDirectory(directory);
                    DownloadFile(update.DownloadUrl, packagePath, cancellationToken);
                    VerifySha256(packagePath, update.Sha256, cancellationToken);
                    return packagePath;
                }
                catch
                {
                    TryDeleteDirectory(directory);
                    throw;
                }
            }, cancellationToken);
        }

        public static void DeleteDownloadedPackage(string packagePath)
        {
            if (string.IsNullOrWhiteSpace(packagePath)) return;
            TryDeleteDirectory(Path.GetDirectoryName(packagePath));
        }

        public static string ReadInstalledVersion(string root)
        {
            try
            {
                string manifestPath = Path.Combine(root, "release-manifest.json");
                if (!File.Exists(manifestPath)) return "development";
                string json = File.ReadAllText(manifestPath, Encoding.UTF8);
                var manifest = new JavaScriptSerializer().DeserializeObject(json) as Dictionary<string, object>;
                return ReadString(manifest, "version") ?? "legacy";
            }
            catch
            {
                return "legacy";
            }
        }

        public static string NormalizeVersion(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            string trimmed = value.Trim();
            if (trimmed.StartsWith("v", StringComparison.OrdinalIgnoreCase)) trimmed = trimmed.Substring(1);
            Match match = VersionPattern.Match(trimmed);
            return match.Success ? match.Groups["version"].Value : null;
        }

        public static bool IsNewerVersion(string currentValue, string latestValue)
        {
            string current = NormalizeVersion(currentValue);
            string latest = NormalizeVersion(latestValue);
            Version currentVersion;
            Version latestVersion;
            if (!Version.TryParse(current ?? "0.0.0", out currentVersion)) currentVersion = new Version(0, 0, 0);
            if (!Version.TryParse(latest ?? "0.0.0", out latestVersion)) return false;
            return latestVersion > currentVersion;
        }

        public static bool IsApplyUpdateRequest(string[] args)
        {
            return args != null
                && args.Length > 0
                && string.Equals(args[0], "--apply-update", StringComparison.OrdinalIgnoreCase);
        }

        public static string LaunchUpdater(
            string executablePath,
            string packagePath,
            string installRoot,
            int parentProcessId,
            bool restartHidden)
        {
            string updaterPath = Path.Combine(
                Path.GetTempPath(),
                "KLineTrainingCamp.Updater." + Guid.NewGuid().ToString("N") + ".exe");
            try
            {
                File.Copy(executablePath, updaterPath, true);
                var startInfo = new ProcessStartInfo
                {
                    FileName = updaterPath,
                    Arguments = BuildUpdaterArguments(packagePath, installRoot, parentProcessId, restartHidden),
                    WorkingDirectory = Path.GetTempPath(),
                    UseShellExecute = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                };
                Process.Start(startInfo);
                return updaterPath;
            }
            catch
            {
                TryDeleteFile(updaterPath);
                throw;
            }
        }

        public static string BuildUpdaterArguments(
            string packagePath,
            string installRoot,
            int parentProcessId,
            bool restartHidden)
        {
            var builder = new StringBuilder();
            builder.Append(QuoteArgument("--apply-update"));
            builder.Append(" ");
            builder.Append(QuoteArgument(packagePath));
            builder.Append(" ");
            builder.Append(QuoteArgument(installRoot));
            builder.Append(" ");
            builder.Append(parentProcessId.ToString());
            if (restartHidden) builder.Append(" --hidden");
            return builder.ToString();
        }

        public static int RunUpdater(string[] args)
        {
            string installRoot = args != null && args.Length > 2 ? args[2] : null;
            try
            {
                if (args == null || args.Length < 4) throw new ArgumentException("更新参数不完整。");
                string packagePath = args[1];
                installRoot = Path.GetFullPath(args[2]);
                int parentProcessId;
                if (!int.TryParse(args[3], out parentProcessId)) throw new ArgumentException("更新宿主进程号无效。");
                bool restartHidden = HasArgument(args, "--hidden");
                WaitForParentProcess(parentProcessId);
                ApplyUpdate(packagePath, installRoot, restartHidden);
                ScheduleSelfDelete();
                return 0;
            }
            catch (Exception error)
            {
                WriteUpdateError(installRoot, error);
                try
                {
                    MessageBox.Show(
                        "软件更新失败，已尽量恢复原版本。\r\n\r\n" + error.Message,
                        "K线训练营 2.0 · 更新失败",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                }
                catch { }
                return 1;
            }
        }

        private ReleaseUpdateInfo CheckForUpdate(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            string json = DownloadText(LatestReleaseApiUrl, cancellationToken);
            ReleaseUpdateInfo update = ParseRelease(json, InstalledVersion);
            if (!IsNewerVersion(update.CurrentVersion, update.LatestVersion)) return null;
            return update;
        }

        private static ReleaseUpdateInfo ParseRelease(string json, string currentVersion)
        {
            var release = new JavaScriptSerializer().DeserializeObject(json) as Dictionary<string, object>;
            if (release == null) throw new InvalidDataException("GitHub Release 响应格式无效。");

            string tagName = ReadString(release, "tag_name");
            string latestVersion = NormalizeVersion(tagName);
            if (latestVersion == null) throw new InvalidDataException("最新 Release 没有有效版本号。");

            object rawAssets;
            if (!release.TryGetValue("assets", out rawAssets)) throw new InvalidDataException("最新 Release 没有发布包。");
            var assets = rawAssets as IEnumerable;
            if (assets == null) throw new InvalidDataException("最新 Release 发布包列表无效。");

            foreach (object rawAsset in assets)
            {
                var asset = rawAsset as Dictionary<string, object>;
                if (asset == null) continue;
                string name = ReadString(asset, "name");
                string downloadUrl = ReadString(asset, "browser_download_url");
                string digest = NormalizeSha256(ReadString(asset, "digest"));
                if (!IsPortableAsset(name) || digest == null) continue;
                ValidateDownloadUrl(downloadUrl);
                return new ReleaseUpdateInfo
                {
                    CurrentVersion = currentVersion,
                    LatestVersion = latestVersion,
                    AssetName = name,
                    DownloadUrl = downloadUrl,
                    Sha256 = digest,
                    ReleaseUrl = ReadString(release, "html_url"),
                    ReleaseNotes = ReadString(release, "body") ?? string.Empty,
                };
            }

            throw new InvalidDataException("最新 Release 没有带 SHA-256 的 Windows 便携包。");
        }

        private static bool IsPortableAsset(string name)
        {
            return !string.IsNullOrWhiteSpace(name)
                && name.StartsWith(PortableAssetPrefix, StringComparison.OrdinalIgnoreCase)
                && name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase);
        }

        private static void ValidateDownloadUrl(string value)
        {
            Uri uri;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri)
                || uri.Scheme != Uri.UriSchemeHttps
                || !string.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("Release 下载地址不是受信任的 GitHub HTTPS 地址。");
            }
        }

        private static string NormalizeSha256(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            string digest = value.Trim();
            if (digest.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase)) digest = digest.Substring(7);
            return Sha256Pattern.IsMatch(digest) ? digest.ToLowerInvariant() : null;
        }

        private static string DownloadText(string url, CancellationToken cancellationToken)
        {
            using (HttpWebResponse response = SendRequest(url, "application/vnd.github+json").GetResponse() as HttpWebResponse)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (response == null || response.StatusCode != HttpStatusCode.OK)
                    throw new InvalidOperationException("检查软件更新失败：HTTP 响应无效。");
                using (Stream stream = response.GetResponseStream())
                using (var reader = new StreamReader(stream, Encoding.UTF8))
                {
                    return reader.ReadToEnd();
                }
            }
        }

        private static void DownloadFile(string url, string destination, CancellationToken cancellationToken)
        {
            using (HttpWebResponse response = SendRequest(url, "application/octet-stream").GetResponse() as HttpWebResponse)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (response == null || response.StatusCode != HttpStatusCode.OK)
                    throw new InvalidOperationException("下载软件更新失败：HTTP 响应无效。");
                using (Stream input = response.GetResponseStream())
                using (var output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None, CopyBufferSize, FileOptions.SequentialScan))
                {
                    byte[] buffer = new byte[CopyBufferSize];
                    int read;
                    while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                        output.Write(buffer, 0, read);
                    }
                }
            }
        }

        private static HttpWebRequest SendRequest(string url, string accept)
        {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = "GET";
            request.Accept = accept;
            request.UserAgent = UserAgent;
            request.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            request.Timeout = NetworkTimeoutMilliseconds;
            request.ReadWriteTimeout = NetworkTimeoutMilliseconds;
            return request;
        }

        private static void VerifySha256(string path, string expected, CancellationToken cancellationToken)
        {
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, CopyBufferSize, FileOptions.SequentialScan))
            using (SHA256 algorithm = SHA256.Create())
            {
                byte[] hash = algorithm.ComputeHash(stream);
                cancellationToken.ThrowIfCancellationRequested();
                string actual = ToLowerHex(hash);
                if (!string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("软件更新校验失败：SHA-256 不匹配。");
            }
        }

        private static void ApplyUpdate(string packagePath, string installRoot, bool restartHidden)
        {
            if (!File.Exists(packagePath)) throw new FileNotFoundException("找不到待安装的软件更新包。", packagePath);
            installRoot = NormalizeDirectoryPath(installRoot);
            if (!Directory.Exists(installRoot)) throw new DirectoryNotFoundException("找不到软件安装目录：" + installRoot);

            string updateRoot = installRoot + ".update-" + Guid.NewGuid().ToString("N");
            string backupRoot = installRoot + ".backup-" + Guid.NewGuid().ToString("N");
            string dataBackupRoot = installRoot + ".data-backup-" + Guid.NewGuid().ToString("N");
            bool oldMoved = false;
            bool newMoved = false;
            try
            {
                Directory.CreateDirectory(updateRoot);
                ZipFile.ExtractToDirectory(packagePath, updateRoot);
                ValidateStagedRelease(updateRoot);
                MovePreservedData(installRoot, dataBackupRoot);

                Directory.Move(installRoot, backupRoot);
                oldMoved = true;
                Directory.Move(updateRoot, installRoot);
                newMoved = true;
                RestorePreservedData(dataBackupRoot, installRoot);

                string executable = Path.Combine(installRoot, ControlPanelExecutableName);
                var startInfo = new ProcessStartInfo
                {
                    FileName = executable,
                    Arguments = restartHidden ? "--hidden" : string.Empty,
                    WorkingDirectory = installRoot,
                    UseShellExecute = true,
                    WindowStyle = restartHidden ? ProcessWindowStyle.Hidden : ProcessWindowStyle.Normal,
                };
                Process restarted = Process.Start(startInfo);
                if (restarted == null) throw new InvalidOperationException("新版本控制面板未能启动。");
                if (restarted.WaitForExit(10000))
                    throw new InvalidOperationException("新版本控制面板启动后立即退出。");

                TryDeleteDirectory(backupRoot);
                TryDeleteDirectory(dataBackupRoot);
                TryDeleteFile(packagePath);
            }
            catch
            {
                if (newMoved && Directory.Exists(installRoot))
                {
                    string failedRoot = installRoot + ".failed-" + Guid.NewGuid().ToString("N");
                    try
                    {
                        Directory.Move(installRoot, failedRoot);
                        TryDeleteDirectory(failedRoot);
                    }
                    catch { }
                }
                if (oldMoved && !Directory.Exists(installRoot) && Directory.Exists(backupRoot))
                {
                    try { Directory.Move(backupRoot, installRoot); } catch { }
                }
                try { RestorePreservedData(dataBackupRoot, installRoot); } catch { }
                TryDeleteDirectory(updateRoot);
                TryDeleteDirectory(dataBackupRoot);
                throw;
            }
            finally
            {
                TryDeleteDirectory(updateRoot);
            }
        }

        private static void ValidateStagedRelease(string root)
        {
            if (!File.Exists(Path.Combine(root, ControlPanelExecutableName))
                || !File.Exists(Path.Combine(root, "release-manifest.json"))
                || !Directory.Exists(Path.Combine(root, "web"))
                || !Directory.Exists(Path.Combine(root, "runtime")))
            {
                throw new InvalidDataException("更新包缺少必要的程序文件。");
            }
        }

        private static void MovePreservedData(string installRoot, string dataBackupRoot)
        {
            foreach (string relativePath in PreservedDataPaths())
            {
                string source = Path.Combine(installRoot, relativePath);
                if (!Directory.Exists(source)) continue;
                string destination = Path.Combine(dataBackupRoot, relativePath);
                string parent = Path.GetDirectoryName(destination);
                if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                Directory.Move(source, destination);
            }
        }

        private static void RestorePreservedData(string dataBackupRoot, string installRoot)
        {
            if (!Directory.Exists(dataBackupRoot)) return;
            foreach (string relativePath in PreservedDataPaths())
            {
                string source = Path.Combine(dataBackupRoot, relativePath);
                if (!Directory.Exists(source)) continue;
                string destination = Path.Combine(installRoot, relativePath);
                if (Directory.Exists(destination)) throw new IOException("本地数据目录恢复目标已存在：" + destination);
                string parent = Path.GetDirectoryName(destination);
                if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                Directory.Move(source, destination);
            }
        }

        private static string[] PreservedDataPaths()
        {
            return new[] { @"web\.wrangler", @"web\.local-data" };
        }

        private static void WaitForParentProcess(int processId)
        {
            if (processId <= 0) return;
            try
            {
                using (Process parent = Process.GetProcessById(processId))
                {
                    DateTime deadline = DateTime.UtcNow.AddSeconds(60);
                    while (!parent.HasExited && DateTime.UtcNow < deadline)
                    {
                        parent.WaitForExit(500);
                    }
                    if (!parent.HasExited) throw new TimeoutException("等待旧版本退出超时。");
                }
            }
            catch (ArgumentException)
            {
                // The parent already exited before the updater opened its handle.
            }
        }

        private static void ScheduleSelfDelete()
        {
            string updaterPath = Environment.GetCommandLineArgs()[0];
            string command = "/d /c ping 127.0.0.1 -n 3 > nul & del /f /q " + QuoteArgument(updaterPath);
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe",
                    Arguments = command,
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden,
                });
            }
            catch { }
        }

        private static void WriteUpdateError(string installRoot, Exception error)
        {
            try
            {
                string directory = string.IsNullOrWhiteSpace(installRoot) ? Path.GetTempPath() : installRoot;
                string path = Path.Combine(directory, "update-error.log");
                File.AppendAllText(
                    path,
                    "[" + DateTime.Now.ToString("s") + "] " + error + Environment.NewLine,
                    Encoding.UTF8);
            }
            catch { }
        }

        private static bool HasArgument(string[] args, string expected)
        {
            if (args == null) return false;
            foreach (string arg in args)
                if (string.Equals(arg, expected, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        private static string ReadString(Dictionary<string, object> values, string key)
        {
            if (values == null) return null;
            object value;
            return values.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : null;
        }

        private static string ToLowerHex(byte[] bytes)
        {
            var builder = new StringBuilder(bytes.Length * 2);
            foreach (byte value in bytes) builder.Append(value.ToString("x2"));
            return builder.ToString();
        }

        private static string QuoteArgument(string value)
        {
            if (value == null) return "\"\"";
            var builder = new StringBuilder();
            builder.Append('"');
            int backslashes = 0;
            foreach (char character in value)
            {
                if (character == '\\')
                {
                    backslashes++;
                    continue;
                }
                if (character == '"')
                {
                    builder.Append(new string('\\', backslashes * 2 + 1));
                    builder.Append('"');
                    backslashes = 0;
                    continue;
                }
                if (backslashes > 0) builder.Append(new string('\\', backslashes));
                builder.Append(character);
                backslashes = 0;
            }
            if (backslashes > 0) builder.Append(new string('\\', backslashes * 2));
            builder.Append('"');
            return builder.ToString();
        }

        private static string NormalizeDirectoryPath(string path)
        {
            string normalized = Path.GetFullPath(path);
            if (normalized.Length > 3)
                normalized = normalized.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            return normalized;
        }

        private static void TryDeleteFile(string path)
        {
            try
            {
                if (!string.IsNullOrWhiteSpace(path) && File.Exists(path)) File.Delete(path);
            }
            catch { }
        }

        private static void TryDeleteDirectory(string path)
        {
            try
            {
                if (!string.IsNullOrWhiteSpace(path) && Directory.Exists(path)) Directory.Delete(path, true);
            }
            catch { }
        }
    }
}
