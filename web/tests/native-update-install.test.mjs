import assert from "node:assert/strict";
import { spawnSync, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("软件更新自动安装、保留本地数据，并在新版本无法启动时恢复原版本", { skip: process.platform !== "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "kline-install-flow-"));
  try {
    const compiler = [
      join(process.env.WINDIR, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
      join(process.env.WINDIR, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
    ].find(existsSync);
    assert.ok(compiler, "找不到 .NET Framework csc.exe");

    const harness = join(directory, "InstallHarness.cs");
    const executable = join(directory, "InstallHarness.exe");
    await writeFile(harness, String.raw`
using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading;
using KLineTrainingCamp.Launcher;

internal static class InstallHarness
{
    private static void AddFile(ZipArchive archive, string path, byte[] bytes)
    {
        using (Stream output = archive.CreateEntry(path).Open()) output.Write(bytes, 0, bytes.Length);
    }

    private static void Check(bool workingRelease, string parent, string downloadUrl)
    {
        string name = workingRelease ? "success" : "rollback";
        string install = Path.Combine(parent, name);
        string data = Path.Combine(install, "web", ".local-data");
        string state = Path.Combine(install, "web", ".wrangler");
        Directory.CreateDirectory(data);
        Directory.CreateDirectory(state);
        File.WriteAllText(Path.Combine(data, "saved.txt"), "local-data");
        File.WriteAllText(Path.Combine(state, "saved.txt"), "wrangler");
        File.WriteAllText(Path.Combine(install, "release-manifest.json"), "old");
        File.WriteAllText(Path.Combine(install, "old.txt"), "old-version");

        string package = Path.Combine(parent, name + ".zip");
        byte[] program = workingRelease ? File.ReadAllBytes(Assembly.GetExecutingAssembly().Location) : new byte[] { 1, 2, 3 };
        using (ZipArchive archive = ZipFile.Open(package, ZipArchiveMode.Create))
        {
            AddFile(archive, "KLineTrainingCamp.ControlPanel.exe", program);
            AddFile(archive, "release-manifest.json", System.Text.Encoding.UTF8.GetBytes("new"));
            AddFile(archive, "web/package.json", new byte[] { 123, 125 });
            AddFile(archive, "runtime/node.exe", new byte[] { 1 });
        }

        if (workingRelease)
        {
            string hash;
            using (SHA256 sha = SHA256.Create())
            using (FileStream stream = File.OpenRead(package))
                hash = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            var service = new NativeUpdateService(parent, false);
            var update = new ReleaseUpdateInfo {
                AssetName = "test-release.zip", DownloadUrl = downloadUrl, Sha256 = hash
            };
            package = service.DownloadPackageAsync(update, null, CancellationToken.None).GetAwaiter().GetResult();
        }

        MethodInfo apply = typeof(NativeUpdateService).GetMethod("ApplyUpdate", BindingFlags.NonPublic | BindingFlags.Static);
        bool failed = false;
        try { apply.Invoke(null, new object[] { package, install, false }); }
        catch (TargetInvocationException) { failed = true; }
        if (failed == workingRelease) throw new Exception("安装结果与预期不符：" + name);
        if (File.ReadAllText(Path.Combine(install, "release-manifest.json")) != (workingRelease ? "new" : "old"))
            throw new Exception("版本文件不正确：" + name);
        if (File.ReadAllText(Path.Combine(data, "saved.txt")) != "local-data"
            || File.ReadAllText(Path.Combine(state, "saved.txt")) != "wrangler")
            throw new Exception("本地数据未保留：" + name);
        if (File.Exists(Path.Combine(install, "old.txt")) == workingRelease)
            throw new Exception("旧版本文件处理不正确：" + name);
    }

    public static void Main(string[] args)
    {
        if (args.Length == 0) { Thread.Sleep(12000); return; }
        try
        {
            Check(true, args[0], args[1]);
            Check(false, args[0], args[1]);
            Thread.Sleep(2500);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.GetType().Name + ": " + error.Message);
            if (error.InnerException != null)
                Console.Error.WriteLine(error.InnerException.GetType().Name + ": " + error.InnerException.Message);
            Environment.ExitCode = 1;
        }
    }
}
`, "utf8");
    const source = fileURLToPath(new URL("../../launcher/NativeUpdateService.cs", import.meta.url));
    const build = spawnSync(compiler, [
      "/nologo", "/target:exe", `/out:${executable}`,
      "/reference:System.IO.Compression.dll",
      "/reference:System.IO.Compression.FileSystem.dll",
      "/reference:System.Windows.Forms.dll",
      "/reference:System.Web.Extensions.dll",
      source, harness,
    ], { encoding: "utf8" });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    const server = createServer(async (request, response) => {
      if (request.url !== "/release") {
        response.writeHead(404).end();
        return;
      }
      const archive = await readFile(join(directory, "success.zip"));
      response.writeHead(200, { "Content-Length": archive.length, "Content-Type": "application/octet-stream" });
      response.end(archive);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      await execFileAsync(executable, [directory, `http://127.0.0.1:${server.address().port}/release`], { timeout: 25000 });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await rm(directory, { recursive: true, force: true });
        break;
      } catch (error) {
        if (error.code !== "EBUSY" || attempt === 19) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
});
