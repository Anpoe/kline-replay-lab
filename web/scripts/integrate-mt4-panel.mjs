import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const [panelFile, outputDir, manifestFile] = process.argv.slice(2);
if (!panelFile || !outputDir || !manifestFile) throw new Error("Usage: node integrate-mt4-panel.mjs <original-panel.mq4> <output-directory> <private-manifest-file>");
const decode = b => (b[0] === 255 && b[1] === 254 ? b.subarray(2).toString("utf16le") : b.toString("utf8").replace(/^\uFEFF/, "")).replace(/\r\n/g, "\n");
const panelBytes = await readFile(panelFile), original = decode(panelBytes);
const alreadyIntegrated = original.includes('"KLineTrainingBridge.mqh"');
const bridge = decode(await readFile(new URL("../public/mt4/KLineTradeBridge.mq4", import.meta.url)));
const names = new Set([...bridge.matchAll(/^(?:string|int|bool|void|long|double)\s+(\w+)\s*\(/gm)].map(m => m[1]));
for (const name of ["Receipt", "receipts", "journal", "sessionId", "selectedSymbol", "selectedTimeframe", "working", "lastHttpError", "serverOffset", "observedServerTime", "timeReady", "connectionRetryable", "connectionError", "archiveResult", "lastFullPoll", "lastTransportPoll", "fastPollMs", "failedPolls", "BRIDGE_MAGIC"]) names.add(name);
let moduleSource = bridge.replace(/^#property.*\n/gm, "")
  .replace("#define BRIDGE_MAGIC 20261013", "#define BRIDGE_MAGIC KLC_GetPanelMagic()")
  .replace(/  if\(!EventSetMillisecondTimer\(100\)\) \{[^\n]+\}\n/, "")
  .replace(/EventKillTimer\(\);/g, "").replace(/ExpertRemove\(\);/g, "KLC_DisableConnection();");
moduleSource = moduleSource.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\/)|\b([A-Za-z_]\w*)\b/g,
  (whole, protectedText, identifier) => protectedText || (names.has(identifier) ? `KLC_${identifier}` : identifier));
if (/EventSetTimer\(|EventSetMillisecondTimer\(|EventKillTimer\(/.test(moduleSource)) throw new Error("Embedded connection must not own the panel timer.");
moduleSource = `#ifndef KLINE_TRAINING_BRIDGE_MQH\n#define KLINE_TRAINING_BRIDGE_MQH\ninput bool InpKLineConnection = true;\nbool KLC_ready = false;\nbool KLC_retryInit = false;\nuint KLC_lastPoll = 0;\nuint KLC_lastInit = 0;\n${moduleSource}
void KLC_DisableConnection() {
  KLC_ready = false;
  KLC_retryInit = false;
  if(KLC_journal != INVALID_HANDLE) FileClose(KLC_journal);
  KLC_journal = INVALID_HANDLE;
  Print("KLine connection stopped. Verify pending orders and reload connection configuration.");
}
bool KLC_Start() {
  KLC_ready = false;
  KLC_retryInit = false;
  if(!InpKLineConnection || StringLen(InpPairToken) == 0) return true;
  KLC_ready = KLC_OnInit() == INIT_SUCCEEDED;
  KLC_retryInit = !KLC_ready && KLC_connectionRetryable;
  KLC_lastInit = GetTickCount();
  KLC_lastPoll = 0;
  return KLC_ready;
}
void KLC_Pump() {
  if(!KLC_ready && KLC_retryInit && (uint)(GetTickCount() - KLC_lastInit) >= 2000) KLC_Start();
  if(!KLC_ready) return;
  KLC_OnTimer();
}
void KLC_Stop() { KLC_ready = false; KLC_retryInit = false; KLC_OnDeinit(0); }
#endif\n`;
let panel = original;
if (!alreadyIntegrated) {
panel = original.replace("   if(!EventSetMillisecondTimer(interval))", "   if(InpKLineConnection) interval = MathMin(interval, 100);\n   if(!EventSetMillisecondTimer(interval))");
const includeAnchor = '#include "BatchOrderBridge.mqh"';
const initAnchor = "   return(INIT_SUCCEEDED);";
for (const anchor of [includeAnchor, initAnchor]) if (panel.split(anchor).length !== 2) throw new Error(`Integration anchor is ambiguous: ${anchor}`);
panel = panel.replace(includeAnchor, `${includeAnchor}\n#include "KLineTrainingBridge.mqh"`)
  .replace(/#property version "[^"]+"/, '#property version "1.15"')
  .replace(initAnchor, '   if(!KLC_Start()) SetStatus(KLC_connectionError);\n' + initAnchor)
  .replace(/(void OnTimer\(\)\s*\{)/, '$1\n   bool connectionWasReady = KLC_ready;\n   KLC_Pump();\n   if(!connectionWasReady && KLC_ready) SetStatus("连接已准备，请在训练营验证连接");\n   static uint panelTimerAt = 0;\n   uint panelNow = GetTickCount();\n   int panelInterval = gBridgeMode == BRIDGE_OFF ? 250 : gBridgePollMilliseconds;\n   if(panelInterval <= 0) panelInterval = 50;\n   if(panelInterval > 250) panelInterval = 250;\n   if(panelTimerAt != 0 && (uint)(panelNow - panelTimerAt) < (uint)panelInterval) return;\n   panelTimerAt = panelNow;')
  .replace(/(void OnDeinit\(const int reason\)\s*\{)/, "$1\n   KLC_Stop();");
panel += "\nint KLC_GetPanelMagic() { return gMagicNumber; }\n";
}
panel = panel.replace(/#property version "[^"]+"/, '#property version "1.15"');
if (!panel.includes("KLC_Start()") || !panel.includes("KLC_GetPanelMagic()")) throw new Error("Required panel integration hook was not found.");
if (!panel.includes("KLC_Pump();") || !panel.includes("KLC_Stop();")) throw new Error("Required panel event hook was not found.");
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, "KLineTrainingBridge.mqh"), "\uFEFF" + moduleSource);
await writeFile(path.join(outputDir, "BatchOrderPanelEA.mq4"), "\uFEFF" + panel);
const files = ["BatchOrderMath.mqh", "BatchOrderTemplate.mqh", "BatchOrderBridge.mqh"];
const manifest = { source: panelFile, sourceHash: createHash("sha256").update(panelBytes).digest("hex"), dependencies: {}, panelVersion: "1.15", bridgeVersion: "1.08" };
for (const file of files) { const bytes = await readFile(path.join(path.dirname(panelFile), file)); await writeFile(path.join(outputDir, file), bytes); manifest.dependencies[file] = createHash("sha256").update(bytes).digest("hex"); }
await mkdir(path.dirname(manifestFile), { recursive: true });
await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
process.stdout.write("Panel and embedded bridge generated. Original source was not modified.\n");
