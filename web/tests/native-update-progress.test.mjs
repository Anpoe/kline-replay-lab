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

test("软件更新显示实际下载字节数，服务器未提供总量时仍有进度", { skip: process.platform !== "win32" }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "kline-update-progress-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const compiler = [
    join(process.env.WINDIR, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    join(process.env.WINDIR, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ].find(existsSync);
  assert.ok(compiler, "找不到 .NET Framework csc.exe");

  const harness = join(directory, "ProgressHarness.cs");
  const executable = join(directory, "ProgressHarness.exe");
  await writeFile(harness, String.raw`
using System;
using System.Collections.Generic;
using System.Reflection;
using System.Threading;
using KLineTrainingCamp.Launcher;

internal sealed class ProgressHarness : IProgress<UpdateDownloadProgress>
{
    private readonly List<UpdateDownloadProgress> reports = new List<UpdateDownloadProgress>();

    public void Report(UpdateDownloadProgress value) { reports.Add(value); }

    public static void Main(string[] args)
    {
        try
        {
            var progress = new ProgressHarness();
            typeof(NativeUpdateService).GetMethod("DownloadFile", BindingFlags.NonPublic | BindingFlags.Static)
                .Invoke(null, new object[] { args[0], args[1], progress, CancellationToken.None });
            UpdateDownloadProgress first = progress.reports[0];
            UpdateDownloadProgress last = progress.reports[progress.reports.Count - 1];
            Console.WriteLine(first.DownloadedBytes + "," + first.TotalBytes + "," + last.DownloadedBytes + "," + last.TotalBytes);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
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
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  await assert.rejects(execFileAsync(executable, [], { windowsHide: true }), (error) => {
    assert.equal(error.code, 1, "测试程序遇到异常时仍须让测试失败");
    assert.match(error.stderr, /IndexOutOfRangeException/);
    return true;
  });

  const payload = Buffer.alloc(150_000, 7);
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/octet-stream");
    if (request.url === "/known") response.setHeader("Content-Length", payload.length);
    response.write(payload.subarray(0, 70_000));
    response.end(payload.subarray(70_000));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  for (const [path, expectedTotal] of [["known", payload.length], ["unknown", -1]]) {
    const destination = join(directory, `${path}.zip`);
    const { stdout } = await execFileAsync(executable, [`http://127.0.0.1:${server.address().port}/${path}`, destination], { windowsHide: true });
    const [initialBytes, initialTotal, finalBytes, finalTotal] = stdout.trim().split(",").map(Number);
    assert.equal(initialBytes, 0);
    assert.equal(initialTotal, expectedTotal);
    assert.equal(finalBytes, payload.length);
    assert.equal(finalTotal, expectedTotal);
    assert.deepEqual(await readFile(destination), payload);
  }
});
