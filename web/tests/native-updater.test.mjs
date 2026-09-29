import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("更新器在较深的安装位置解压发布包并识别外层目录", { skip: process.platform !== "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "kline-updater-test-"));
  try {
    const compiler = [
      join(process.env.WINDIR, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
      join(process.env.WINDIR, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
    ].find(existsSync);
    assert.ok(compiler, "找不到 .NET Framework csc.exe");

    const harness = join(directory, "UpdaterHarness.cs");
    const executable = join(directory, "UpdaterHarness.exe");
    await writeFile(harness, String.raw`
using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using KLineTrainingCamp.Launcher;

internal static class UpdaterHarness
{
    private static object Call(string name, params object[] args)
    {
        MethodInfo method = typeof(NativeUpdateService).GetMethod(name, BindingFlags.NonPublic | BindingFlags.Static);
        return method.Invoke(null, args);
    }

    private static void AddRelease(ZipArchive archive, string prefix)
    {
        archive.CreateEntry(prefix + "KLineTrainingCamp.ControlPanel.exe");
        archive.CreateEntry(prefix + "release-manifest.json");
        archive.CreateEntry(prefix + "runtime/node.exe");
        archive.CreateEntry(prefix + "web/package.json");
        archive.CreateEntry(prefix + "web/node_modules/next/dist/compiled/react-server-dom-turbopack-experimental/cjs/react-server-dom-turbopack-server.browser.development.js");
    }

    private static void Check(string parent, string prefix)
    {
        string zip = Path.Combine(parent, prefix.Length == 0 ? "flat.zip" : "wrapped.zip");
        using (ZipArchive archive = ZipFile.Open(zip, ZipArchiveMode.Create)) AddRelease(archive, prefix);

        string stage = (string)Call("CreateSiblingPath", parent, ".u-");
        string oldStage = Path.Combine(parent, "KLineTrainingCamp-Portable") + ".update-" + new string('0', 32);
        string longest = prefix + "web/node_modules/next/dist/compiled/react-server-dom-turbopack-experimental/cjs/react-server-dom-turbopack-server.browser.development.js";
        if (Path.Combine(oldStage, longest).Length <= 260) throw new Exception("夹具未覆盖原路径过长问题");
        if (Path.Combine(stage, longest).Length >= 260) throw new Exception("新的解压路径仍过长");

        Directory.CreateDirectory(stage);
        ZipFile.ExtractToDirectory(zip, stage);
        string release = (string)Call("FindStagedReleaseRoot", stage);
        string expected = prefix.Length == 0 ? stage : Path.Combine(stage, prefix.TrimEnd('/'));
        if (!string.Equals(release, expected, StringComparison.OrdinalIgnoreCase))
            throw new Exception("发布包根目录识别错误：" + release);
    }

    public static void Main(string[] args)
    {
        Check(args[0], "KLineTrainingCamp-Portable/");
        Check(args[0], "");
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

    const run = spawnSync(executable, [directory], { encoding: "utf8" });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
