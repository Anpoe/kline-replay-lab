# Always In MT4 Alert EA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone MT4 Expert Advisor that mirrors the training app's strict Always In Long/Short state, alerts on closed candles with a 10-bar cooldown, and never submits or manages orders.

**Architecture:** Keep the EA isolated under `mt4/` and do not modify the web training core. A small JavaScript cooldown model and contract tests provide deterministic coverage in this repository; the `.mq4` file mirrors the already-tested state algorithm and is verified by static safety checks because MetaEditor is not installed in the workspace.

**Tech Stack:** MQL4 (`#property strict`, `OnInit`, `OnTick`), Node.js built-in test runner, existing TypeScript pattern-filter behavior as the parity reference.

**Spec:** `docs/superpowers/specs/2026-08-24-always-in-mt4-alert-ea-design.md`

## Global Constraints

- Use the current chart's symbol and timeframe; do not hard-code EURUSD or M5.
- Read only closed candles; the forming candle must never trigger an alert.
- Use one global cooldown of exactly 10 current-timeframe bars for Long and Short.
- Include no `OrderSend`, `OrderModify`, `OrderClose`, `OrderDelete`, pending-order, or position-management code.
- Do not modify `web/app`, the database, training execution, or existing pattern-filter behavior.
- Do not commit or push automatically; preserve the existing dirty worktree.

---

### Task 1: Add failing EA contract and cooldown tests

**Files:**
- Create: `mt4/tests/always-in-alert.test.mjs`
- Read-only reference: `web/app/lib/patternFilters.ts`

**Interfaces:**
- Consumes: the expected EA path `mt4/AlwaysInStructureAlert.mq4` and model API `mt4/always-in-alert-model.mjs`.
- Produces: deterministic tests that initially fail because the new artifact/model do not exist.

- [x] **Step 1: Write the failing tests**

  Test the following behaviors:

  1. The EA source exists, exposes the nine screenshot parameters plus `InpCooldownBars = 10`, and contains `OnInit`/`OnTick`.
  2. The EA source contains alert APIs but none of `OrderSend`, `OrderModify`, `OrderClose`, `OrderDelete`, `OrderSelect`, or `OrderType`.
  3. `cooldownAlertIndices([1, 1, 1, -1, -1, -1, -1], 2)` returns `[0, 3, 6]`, proving opposite directions share the cooldown.
  4. A forming-bar input is not accepted by the model's closed-bar contract.

- [x] **Step 2: Run the focused test and verify the expected RED result**

  Run from the repository root:

  ```powershell
  node --test mt4/tests/always-in-alert.test.mjs
  ```

  Expected result: failure because `mt4/AlwaysInStructureAlert.mq4` and `mt4/always-in-alert-model.mjs` are not yet present.

### Task 2: Implement the deterministic cooldown model and the MQL4 EA

**Files:**
- Create: `mt4/always-in-alert-model.mjs`
- Create: `mt4/AlwaysInStructureAlert.mq4`

**Interfaces:**
- Consumes: the screenshot parameters and the state semantics in `web/app/lib/patternFilters.ts` (`alwaysInStateSeries`, `findPatternMatches`).
- Produces: `cooldownAlertIndices(states, cooldownBars)` for tests and a directly compilable MT4 EA with `OnInit()`/`OnTick()`.

- [x] **Step 1: Implement the model's closed-bar cooldown helper**

  Export:

  ```js
  export function cooldownAlertIndices(states, cooldownBars = 10) {
    const accepted = [];
    let lastAccepted = -cooldownBars - 1;
    for (let index = 0; index < states.length; index += 1) {
      if (!states[index] || index - lastAccepted <= cooldownBars) continue;
      accepted.push(index);
      lastAccepted = index;
    }
    return accepted;
  }
  ```

  Export `assertClosedBarIndex(index, barCount)` that rejects indexes below `1` or at/after `barCount`, making the no-forming-candle rule explicit in tests.

- [x] **Step 2: Implement the EA input and lifecycle shell**

  Add `#property strict`, the nine screenshot inputs, `input int InpCooldownBars = 10`, `input int InpHistoryBars = 5000`, and optional sound/push/email inputs. `OnInit()` records the current closed-bar timestamp without alerting. `OnTick()` returns unless a new current-bar timestamp exists, then evaluates shift `1` and calls the alert function only when a direction is active and the global cooldown has elapsed.

- [x] **Step 3: Port the state algorithm without order code**

  Use a chronological local `BarData` array populated from `iTime/iOpen/iHigh/iLow/iClose` for shifts `history-1` down to `1`. Port confirmed pivots, pending breakout follow-through, state expiration, EMA-side control, EMA-cross count, and final state selection for both directions. The target bar is always the final closed element; no shift `0` values enter the array.

- [x] **Step 4: Add alert-only output**

  Build a message containing `Symbol()`, the custom timeframe label, `Long` or `Short`, the closed-bar time, and the cooldown setting. Call `Alert()` and `Print()` by default; call `PlaySound`, `SendNotification`, or `SendMail` only behind explicit inputs. Do not add any trade or position API.

### Task 3: Add installation and operator documentation

**Files:**
- Create: `mt4/README.md`

**Interfaces:**
- Consumes: the EA inputs and alert behavior from Task 2.
- Produces: copy/compile/attach instructions and the explicit statement that alerts require user judgment and the EA cannot trade.

- [x] **Step 1: Document installation**

  Explain copying `AlwaysInStructureAlert.mq4` into `MQL4/Experts`, opening it in MetaEditor, compiling, attaching it to any forex chart/timeframe, enabling the desired MT4 notification channels, and removing/re-attaching after input changes.

- [x] **Step 2: Document the 10-bar cooldown and closed-bar timing**

  State that alerts arrive after the new candle opens, because the preceding candle has just closed; consecutive state bars do not bypass the global cooldown.

### Task 4: Verify the feature and regression safety

**Files:**
- Test: `mt4/tests/always-in-alert.test.mjs`
- Inspect: `mt4/AlwaysInStructureAlert.mq4`, `mt4/README.md`

- [x] **Step 1: Run the focused tests**

  ```powershell
  node --test mt4/tests/always-in-alert.test.mjs
  ```

  Expected: all EA contract, cooldown, and closed-bar tests pass.

- [x] **Step 2: Run static order-safety and diff checks**

  ```powershell
  rg -n "OrderSend|OrderModify|OrderClose|OrderDelete|OrderSelect|OrderType" mt4/AlwaysInStructureAlert.mq4
  git diff --check
  ```

  Expected: the first command returns no matches and `git diff --check` exits successfully.

- [x] **Step 3: Run existing web regression checks**

  ```powershell
  Push-Location web
  npm run typecheck
  npm run lint
  node --test tests/pattern-filters.test.mjs
  Pop-Location
  ```

  Expected: existing web behavior remains green; any pre-existing ControlPanel executable lock is reported separately.

- [x] **Step 4: Report MetaEditor limitation and handoff**

  If `metaeditor.exe` is not available, state that local compilation was not possible and give the exact MetaEditor compile step. Do not claim MT4 binary compilation passed without that tool.
