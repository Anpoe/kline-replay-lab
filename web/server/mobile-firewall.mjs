import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

// Only called after an explicit in-app action. UAC belongs to Windows; shell windows stay hidden.
export function mobileFirewallCommand(port, executable = process.execPath) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("网页连接信息无效，请重启服务后重试。");
  const rule = `KLineTrainingCamp-Mobile-${createHash("sha256").update(executable).digest("hex").slice(0, 12)}-${port}`;
  const program = executable.replaceAll("'", "''");
  const elevated = `$ErrorActionPreference='Stop'; try { Get-NetFirewallRule -Name '${rule}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule; New-NetFirewallRule -Name '${rule}' -DisplayName 'KLineTrainingCamp Mobile' -Direction Inbound -Action Allow -Enabled True -Profile Private -Protocol TCP -LocalPort ${port} -RemoteAddress LocalSubnet -Program '${program}' | Out-Null; exit 0 } catch { exit 1 }`;
  const encoded = Buffer.from(elevated, "utf16le").toString("base64");
  const wrapper = `$ErrorActionPreference='Stop'; try { $mobileFirewallProcess=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','${encoded}') -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $mobileFirewallProcess.ExitCode } catch { exit 1 }`;
  return {
    file: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    args: ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(wrapper, "utf16le").toString("base64")],
    options: { windowsHide: true, timeout: 120_000, maxBuffer: 4096 },
  };
}

export async function allowMobileFirewall(port) {
  if (process.platform !== "win32") throw Object.assign(new Error("请在系统网络设置中允许训练营接受本地网络连接。"), { status: 400 });
  const command = mobileFirewallCommand(port);
  await new Promise((resolve, reject) => {
    execFile(command.file, command.args, command.options, (error) => {
      if (error) reject(Object.assign(new Error("本地网络连接尚未放行。请接受 Windows 授权，并将当前 Wi-Fi 设为专用网络后重试。"), { status: 503 }));
      else resolve();
    });
  });
}
