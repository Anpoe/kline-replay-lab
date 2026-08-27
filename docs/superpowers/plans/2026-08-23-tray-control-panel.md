# 托盘控制面板与后台更新实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有本地启动 BAT 升级为 Windows 托盘控制面板，并把每日自动更新从浏览器迁移到独立 Node 后台 worker。

**Architecture:** PowerShell/.NET WinForms 面板管理 3100 本机行情服务、3101 Web 服务和 3102 后台 worker；worker 通过现有 3101 API 编排数据库任务，WebUI 仅做训练、手动操作和只读状态展示。每日 claim 以运行软件这台机器的系统本地日期和数据库租约为最终一致性边界。

**Tech Stack:** Windows PowerShell 5.1、System.Windows.Forms、Node.js 22、Node built-in `http`/`fetch`/`crypto`、现有 Vinext/Cloudflare D1 API、Node test runner。

**Spec:** `docs/superpowers/specs/2026-08-23-tray-control-panel-design.md`

## Global Constraints

- 不修改数据库 schema、迁移、快照格式、交易规则、行情标准化或外部供应商语义。
- UI feature 不直接访问 D1 runtime；后台 worker 只通过 `http://127.0.0.1:3101/api/*` 调用现有服务端 API。
- 每日自动任务启动后检查一次，同一天终态不自动重复；超过租约的旧 `running` 状态允许恢复。
- 所有本机控制接口只绑定回环地址；不自动开放公网端口，不记录 Token/Secret。
- 不覆盖工作区已有未提交改动，不自动提交或推送 Git。
- 生产代码必须遵循 TDD：每个新增行为先写失败测试并观察失败，再实现最小代码。

---

### Task 1: 锁定同日自动更新 claim 语义

**Files:**
- Modify: `web/tests/data-auto-update.test.mjs`
- Modify: `web/app/lib/dataAutoUpdateSettings.ts`

**Interfaces:**
- Consumes: existing `DataAutoUpdateSettings`, `shouldClaimDataAutoUpdate`, `claimDataAutoUpdate`.
- Produces: `shouldClaimDataAutoUpdate(settings, date, nowMs)` returns `false` for any same-date terminal status and `true` for a different date or an expired `running` lease.

- [ ] **Step 1: Write the failing test**

Replace the same-day retry assertions with the required behavior and add the next-day case:

```js
test("同日终态不再自动 claim，跨日才会再次 claim", () => {
  assert.equal(shouldClaimDataAutoUpdate(settings({ enabled: false }), today, now.getTime()), false);
  assert.equal(shouldClaimDataAutoUpdate(settings(), today, now.getTime()), false);
  assert.equal(shouldClaimDataAutoUpdate(settings({ lastStatus: "failed" }), today, now.getTime()), false);
  assert.equal(shouldClaimDataAutoUpdate(settings({ lastStatus: "partial" }), today, now.getTime()), false);
  assert.equal(shouldClaimDataAutoUpdate(settings({ lastCheckDate: "2026-08-22" }), today, now.getTime()), true);
});
```

Change the concurrent claim fixture to use `lastCheckDate: "2026-08-22"`, so it still proves that two different workers can race on a new day and only one wins.

- [ ] **Step 2: Run the focused test and verify the expected failure**

```powershell
cd web
node --test tests/data-auto-update.test.mjs
```

The same-day failed/partial assertions must fail against the current implementation; do not change production code before observing this failure.

- [ ] **Step 3: Implement the minimal claim change**

Keep expired lease recovery first, then reject any same-date terminal state:

```ts
if (settings.lastStatus === "running") {
  const startedAt = settings.lastStartedAt ? Date.parse(settings.lastStartedAt) : Number.NaN;
  return Number.isFinite(startedAt) && nowMs - startedAt > DATA_AUTO_UPDATE_LEASE_MS;
}
if (settings.lastCheckDate === date) return false;
return true;
```

- [ ] **Step 4: Run the focused test and verify green**

```powershell
node --test tests/data-auto-update.test.mjs
```

All tests in the file must pass, including atomic concurrent claim and token-matched completion.

---

### Task 2: Extract and test the background auto-update orchestrator

**Files:**
- Create: `web/tests/background-auto-update.test.mjs`
- Create: `web/local-data/background-auto-update.mjs`

**Interfaces:**
- Consumes: existing `/api/data-auto-update`, `/api/cn-maintenance`, `/api/data-jobs/market/sync`, `/api/data-jobs/market/sync/worker`, `/api/fx-data`, `/api/fx-data/update`, `/api/fx-data/task`, and `/api/fx-data/run` response shapes.
- Produces:
  - `localDateInTimeZone(now, timeZone)` → `YYYY-MM-DD`.
  - `createBackgroundAutoUpdateRunner(options)` → `{ getState, runIfDue, stop }`.
  - `runIfDue()` returns `{ claimed: false }` when disabled/already checked, or `{ claimed: true, status, updated, skipped, failures }` after completion.

- [ ] **Step 1: Write failing unit tests**

Create a fake fetch router and deterministic clock. Cover these behaviors:

```js
test("按系统本地日期计算跨午夜日期", () => {
  assert.equal(
    localDateInTimeZone(new Date(2026, 7, 24, 0, 30)),
    "2026-08-24",
  );
});

test("自动更新关闭时不 claim 也不创建市场任务", async () => {
  const calls = [];
  const runner = createBackgroundAutoUpdateRunner({
    fetchImpl: fakeFetch(calls, {
      "GET /api/data-auto-update": { settings: { enabled: false, lastStatus: "idle" } },
    }),
    now: () => new Date("2026-08-23T08:00:00.000Z"),
  });

  const result = await runner.runIfDue();

  assert.deepEqual(result, { claimed: false, reason: "disabled" });
  assert.deepEqual(calls.map((call) => call.key), ["GET /api/data-auto-update"]);
});
```

Add tests for an already-claimed date, full CN→US→FX ordering, a market failure that continues to the next market, and a completion call containing the current run token. Assert logs/state contain only safe labels and never the fake provider token.

- [ ] **Step 2: Run the new test and verify the expected missing-module failure**

```powershell
node --test tests/background-auto-update.test.mjs
```

The test must fail because `web/local-data/background-auto-update.mjs` does not yet exist, not because of a malformed test fixture.

- [ ] **Step 3: Implement API helpers and date/state primitives**

Implement timeout-aware JSON requests, local-date formatting, bounded polling sleeps, a state object with `phase`, `market`, `message`, `lastStatus`, `lastFinishedAt`, and a `log(level, message, details)` callback. Keep the Web API origin injectable for tests and default it to `http://127.0.0.1:3101`.

- [ ] **Step 4: Implement the claim and completion lifecycle**

`runIfDue()` must:

1. GET settings and return `disabled` if the switch is off.
2. POST `claim` with a fresh UUID and the Shanghai local date.
3. Return without work when `shouldRun` is false.
4. Run the existing-market check only after a successful claim.
5. Always attempt `complete` with the same token when the workflow has claimed the date, using `partial` when at least one market updated and another failed, and `failed` when no market succeeded.

- [ ] **Step 5: Implement the existing market task adapters**

Keep the current browser controller’s endpoint order and terminal statuses:

- CN: POST incremental maintenance, then GET status until `completed`; surface `failed`/`paused` as a market failure.
- US: POST update, then POST one worker batch at a time until `completed`, `completed_with_errors`, `cancelled`, or `paused`.
- FX: reuse an existing queued/running task, resume paused tasks, otherwise create an update task; POST run until `completed`/`cancelled`.

Use bounded retry only for polling/read requests. Do not retry a task-creation POST blindly, which could create duplicate work.

- [ ] **Step 6: Run the focused tests and refactor only while green**

```powershell
node --test tests/background-auto-update.test.mjs tests/data-auto-update.test.mjs
```

Keep the orchestrator independent of PowerShell and browser globals so it remains directly testable by Node.

---

### Task 3: Add the loopback background worker service

**Files:**
- Create: `web/local-data/background-worker.mjs`
- Create: `web/tests/background-worker.test.mjs`

**Interfaces:**
- Consumes: `createBackgroundAutoUpdateRunner` from Task 2.
- Produces: loopback HTTP service on `KLINE_BACKGROUND_HOST` (default `127.0.0.1`) and `KLINE_BACKGROUND_PORT` (default `3102`) with `GET /health`, `GET /status`, `POST /shutdown`.

- [ ] **Step 1: Write a failing worker contract test**

Test the exported server factory with an ephemeral port:

```js
test("worker health/status 只暴露本机任务摘要", async (t) => {
  const server = createBackgroundWorkerServer({
    runner: fakeRunner({ phase: "idle", lastStatus: "completed" }),
    host: "127.0.0.1",
    port: 0,
  });
  await server.start();
  t.after(() => server.stop());

  const health = await fetch(`http://127.0.0.1:${server.port}/health`).then((r) => r.json());
  const status = await fetch(`http://127.0.0.1:${server.port}/status`).then((r) => r.json());

  assert.equal(health.ok, true);
  assert.equal(status.phase, "idle");
  assert.equal("token" in status, false);
});
```

- [ ] **Step 2: Run the contract test and verify it fails because the service is absent**

```powershell
node --test tests/background-worker.test.mjs
```

- [ ] **Step 3: Implement the HTTP service and scheduler**

Bind only to the loopback host. Start the first `runIfDue()` after the service is listening, then schedule a low-frequency date check (five minutes). Protect the runner with a no-overlap promise so a long update cannot start a second run.

- [ ] **Step 4: Implement clean shutdown**

On `POST /shutdown`, `SIGINT`, and `SIGTERM`, stop the timer, reject new work, close the HTTP server, and exit without marking unfinished work as successful. Keep task persistence in the existing APIs.

- [ ] **Step 5: Run worker and orchestrator tests**

```powershell
node --test tests/background-worker.test.mjs tests/background-auto-update.test.mjs tests/data-auto-update.test.mjs
```

---

### Task 4: Remove browser-side automatic execution and preserve read-only display

**Files:**
- Modify: `web/app/components/TrainingWorkbench.tsx`
- Delete: `web/app/components/DataAutoUpdateController.tsx`
- Modify: `web/app/features/market-data/components/ProviderSettingsPanel.tsx`
- Modify: `web/app/features/market-data/components/DataSourceManager.tsx`
- Modify: `web/tests/mobile-ui.test.mjs`
- Modify: `web/tests/rendered-html.test.mjs` only if an affected source assertion requires it.

**Interfaces:**
- Consumes: existing provider-settings and data-task GET APIs.
- Produces: WebUI no longer mounts a startup task runner; settings/status panels refresh through low-frequency GET polling only.

- [ ] **Step 1: Write failing source-contract assertions**

Update the mobile/UI test to assert that the workbench does not import or render `DataAutoUpdateController`, that `background-worker.mjs` exists, and that the provider settings panel contains a timer-based read-only refresh. Run the test before deleting/changing production files and confirm the old assertions fail.

- [ ] **Step 2: Remove the browser trigger**

Delete the import and `<DataAutoUpdateController />` element from `TrainingWorkbench.tsx`, then delete the unused controller file. Do not alter training state or data task contracts.

- [ ] **Step 3: Add bounded read-only polling**

In `ProviderSettingsPanel`, refresh provider/auto-update status every 10 seconds while mounted, clear the interval on unmount, and keep the existing retry timer/event behavior. In `DataSourceManager` and `TrainingWorkbench`, remove listeners whose only producer was the deleted controller; retain existing polling for tasks explicitly started by the user.

- [ ] **Step 4: Run UI contract tests**

```powershell
node --test tests/mobile-ui.test.mjs tests/rendered-html.test.mjs
```

---

### Task 5: Add the Windows launcher and tray panel

**Files:**
- Create: `启动控制面板.bat`
- Modify: `启动本地网页版.bat`
- Create: `launcher/KLineControlPanel.ps1`
- Create: `web/tests/launcher-contract.test.mjs`

**Interfaces:**
- Consumes: `web/local-data/background-worker.mjs`, current `web/package.json` scripts, Windows PowerShell/WinForms.
- Produces: manual panel launch, hidden startup launch, Start/Stop/Restart actions, health cards, tagged console, tray menu, WebUI button, and idempotent current-user Startup shortcut toggle.

- [ ] **Step 1: Write failing launcher contract tests**

Assert source-level invariants before creating scripts:

```js
test("兼容 BAT 转交独立托盘面板", async () => {
  const [legacy, launcher, panel] = await Promise.all([
    readFile(new URL("../../启动本地网页版.bat", import.meta.url), "utf8"),
    readFile(new URL("../../启动控制面板.bat", import.meta.url), "utf8"),
    readFile(new URL("../../launcher/KLineControlPanel.ps1", import.meta.url), "utf8"),
  ]);
  assert.match(legacy, /启动控制面板\.bat/);
  assert.match(launcher, /powershell\.exe/);
  assert.match(panel, /NotifyIcon/);
  assert.match(panel, /3100/);
  assert.match(panel, /3101/);
  assert.match(panel, /3102/);
  assert.match(panel, /Microsoft\\Windows\\Start Menu\\Programs\\Startup/);
});
```

- [ ] **Step 2: Run the contract test and verify the expected missing-file failure**

```powershell
cd web
node --test tests/launcher-contract.test.mjs
```

- [ ] **Step 3: Implement the two BAT entry points**

`启动控制面板.bat` must invoke Windows PowerShell with `-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File`. The old BAT must keep the known Web/LAN/remote address text and delegate to the panel instead of starting a second service path.

- [ ] **Step 4: Implement process and health helpers in PowerShell**

Use `System.Diagnostics.ProcessStartInfo` with redirected stdout/stderr and `CreateNoWindow`. Track each child process with a service label and `owned` flag. Use `Invoke-WebRequest` against 3100/3101/3102 for health checks. For shutdown, call `taskkill.exe /PID <known-pid> /T /F` only for owned process trees; never use a wildcard or port-owner kill.

- [ ] **Step 5: Implement the WinForms window and tray lifecycle**

Create a fixed-size form with status cards, current task text, log textbox, and buttons for Start/Stop/Restart/Open WebUI. Create a `NotifyIcon` with Show/Hide, Open WebUI, Restart, and Exit menu items. Closing the form cancels the close event and hides it; the explicit Exit menu stops owned services and disposes the icon.

- [ ] **Step 6: Implement startup dependency sequencing**

On form load, check Node/npm and dependency readiness, then start 3100, wait for its exact health signature, start 3101, wait for HTTP 200, and start 3102. Use a WinForms timer for polling so the window remains responsive. Show failed stages in the log and keep Retry enabled.

- [ ] **Step 7: Implement current-user Startup shortcut management**

Create/remove one shortcut under `$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup`, target the panel with a hidden startup argument, and identify the shortcut by a stable project name. The checkbox must read the current state on load and be idempotent when clicked repeatedly.

- [ ] **Step 8: Implement current URL display and safe local logs**

Write rolling logs under `%LOCALAPPDATA%\KLineTrainingCamp\logs`, keep only the latest bounded files, calculate the LAN URL for display, and preserve the existing dynv6 URL text without opening a firewall port. Do not write provider secrets to the log.

- [ ] **Step 9: Run PowerShell syntax and launcher contract checks**

```powershell
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path '.\launcher\KLineControlPanel.ps1'),
  [ref]$null,
  [ref]$errors
)
if ($errors.Count) { $errors | Format-List; exit 1 }
cd web
node --test tests/launcher-contract.test.mjs
```

---

### Task 6: Update documentation, smoke checklist, and focused verification

**Files:**
- Modify: `README.md`
- Modify: `web/README.md`
- Modify: `docs/architecture/smoke-checklist.md` only for the new launcher flow.
- Modify: directly affected tests from Tasks 1–5.

**Interfaces:**
- Consumes: final panel commands, ports, worker status behavior and existing startup instructions.
- Produces: user-facing docs that describe double-clicking the panel, tray behavior, WebUI button, background update semantics, and manual stop behavior.

- [ ] **Step 1: Update local startup documentation**

Document `启动控制面板.bat` as the primary entry, keep the old BAT as a compatibility alias, explain that the panel starts 3100/3101/3102, and state that startup background mode does not open the browser.

- [ ] **Step 2: Run the affected test set**

```powershell
cd web
node --test tests/data-auto-update.test.mjs tests/background-auto-update.test.mjs tests/background-worker.test.mjs tests/launcher-contract.test.mjs tests/mobile-ui.test.mjs tests/rendered-html.test.mjs
```

Fix root causes before moving to global verification.

---

### Task 7: Full verification and CodeGraph review

**Files:**
- No planned production edits; only fix regressions found by verification.

- [ ] **Step 1: Run the required project checks**

```powershell
cd web
npm run typecheck
npm run lint
npm run test:unit
npm run build
npm run verify
npm test
cd ..
git diff --check
```

- [ ] **Step 2: Run CodeGraph status and impact checks**

```powershell
codegraph sync
codegraph status
codegraph query "TrainingWorkbench DataAutoUpdateController background-worker dataAutoUpdateSettings"
codegraph affected web/app/components/TrainingWorkbench.tsx web/app/lib/dataAutoUpdateSettings.ts web/local-data/background-worker.mjs
```

Confirm the deleted controller is no longer an import/caller and no new database runtime import appears in the launcher or worker.

- [ ] **Step 3: Run the local smoke flow when Windows GUI is available**

Double-click the panel BAT, verify the three status cards become healthy, close the WebUI browser tab, confirm the worker remains running, open the WebUI from the tray, toggle the auto-update setting, and verify the status is read-only refreshed. Test hide-to-tray, explicit exit, and startup shortcut add/remove. Do not trigger real external synchronization unless the user explicitly requests it; use existing local/sample data for default smoke checks.
