# 九级 MT4 风格时间周期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让系统在所有周期相关入口统一使用 `M1、M5、M15、M30、H1、H4、D1、W1、MN` 九个周期；每个品种始终显示完整九项，没有真实数据的周期仅灰色禁用，并让可聚合的大周期从同一品种的更小周期生成。

**Architecture:** 新增集中式周期目录，负责标准 ID、MT4 标签、排序和周期比较；现有通用聚合器与 FX session-aware 聚合器都依赖该目录。行情目录返回真实覆盖，UI 用完整目录渲染、用覆盖集合控制 disabled；供应商直连能力与本地聚合能力分开，避免把不可下载的周期标记为有数据。

**Tech Stack:** Next.js/Vite Web app, React/TypeScript, Node test runner, SQLite-compatible API runtime, CodeGraph.

**Spec:** `docs/superpowers/specs/2026-08-25-nine-timeframes-design.md`

## Global Constraints

- 内部周期 ID 保持现有 `1m / 5m / 1h / 1d / 1w`，新增 `15m / 30m / 4h / 1mo`。
- 界面标签使用 `M1、M5、M15、M30、H1、H4、D1、W1、MN`。
- 所有周期选择入口渲染完整九项；无数据项只置灰和禁用，不添加提示文案、title 或额外错误提示。
- 只有更小周期真实存在且允许聚合时才生成更大周期；不得由日线反向生成分钟或小时线。
- 不修改数据库 schema、快照格式、交易执行规则、快捷键行为或供应商原始响应语义。
- 保留工作区已有未提交改动，不使用 destructive Git 命令，不自动提交或推送。
- 共享 `TrainingWorkbench.tsx` 串行编辑；每个纯逻辑新增行为先写失败测试。

## File Map

- Create `web/app/lib/timeframeCatalog.ts`: 九周期 ID、MT4 标签、顺序、排序、合法性和向上聚合比较。
- Modify `web/app/lib/timeframeAggregation.ts`: 使用统一周期类型，增加 15m、30m、4h、1mo 桶和月线 OHLCV 聚合。
- Modify `web/app/lib/timeframeAvailability.ts`: 保留真实覆盖查询，并提供统一的“全量显示 + 可用集合”判定。
- Modify `web/app/lib/fxDataContracts.ts` and `web/app/lib/fx/dukascopyAggregation.ts`: 扩展 FX 周期契约、固定周期桶、自然月和完整桶计算。
- Modify `web/app/lib/fxDataService.ts` and `web/app/features/market-data/components/FxDataControlPanel.tsx`: 让 FX 初始化/增量任务覆盖九周期聚合目标。
- Modify `web/app/lib/marketDataProviders.ts`, `web/app/lib/marketSync.ts`, `web/app/api/data-providers/route.ts`, `web/app/api/data-jobs/route.ts`, `web/app/api/data-jobs/run/route.ts`: 统一周期参数校验，同时区分供应商直连周期与本地可聚合周期。
- Modify `web/app/api/candles/route.ts` and `web/app/api/snapshots/route.ts`: 返回真实周期覆盖，校验九周期，并阻止无来源的观察周期快照。
- Modify `web/app/components/TrainingWorkbench.tsx`, `web/app/features/settings/settingsContracts.ts`, `web/app/features/settings/components/SettingsPanel.tsx`, `web/app/features/review/components/SessionHistoryPanel.tsx`: 所有训练、设置、复盘和绩效入口渲染九项，并按品种覆盖禁用。
- Modify `web/app/features/market-data/components/DataSourceManager.tsx`: 数据维护周期入口使用统一目录和真实供应商/本地能力判定。
- Modify `web/tests/timeframe-aggregation.test.mjs`, `web/tests/timeframe-view.test.mjs`, `web/tests/mobile-ui.test.mjs` and add focused tests for catalog, availability, FX, provider/API contracts as needed.

---

### Task 1: 建立九周期目录与可用性纯逻辑

**Files:**
- Create: `web/app/lib/timeframeCatalog.ts`
- Modify: `web/app/lib/timeframeAvailability.ts`
- Modify: `web/app/features/settings/settingsContracts.ts`
- Test: add `web/tests/timeframe-catalog.test.mjs`
- Test: extend `web/tests/timeframe-availability.test.mjs` or the existing availability assertions in `web/tests/mobile-ui.test.mjs`

**Interfaces:**
- Produces one ordered nine-item catalog, a `TimeframeId` type, display-label lookup, validity check, rank comparison, and fixed/calendar duration helpers.
- Produces availability helpers that return actual available IDs separately from the complete display catalog; an absent coverage field is treated as no available IDs.
- Keeps the existing exported `timeframes` consumer-compatible by deriving it from the catalog rather than maintaining another literal list.

- [ ] **Step 1: Write failing catalog tests** for exact ID order, exact MT4 labels, `1mo` calendar classification, and lower-to-higher comparison.
- [ ] **Step 2: Run the focused catalog test** with the Web Node test command and confirm failure because the shared catalog does not exist yet.
- [ ] **Step 3: Implement the catalog and availability contracts** without changing any UI behavior yet; preserve legacy IDs and make invalid IDs return false/null rather than being coerced.
- [ ] **Step 4: Add failing availability tests** proving a daily-only instrument returns `1d` as available while the display list remains all nine, and an instrument with no coverage returns no available IDs.
- [ ] **Step 5: Implement the availability helpers** and derive settings `timeframes` from the catalog.
- [ ] **Step 6: Run catalog and availability tests** and confirm they pass.

### Task 2: Extend generic and FX aggregation

**Files:**
- Modify: `web/app/lib/timeframeAggregation.ts`
- Modify: `web/app/lib/fxDataContracts.ts`
- Modify: `web/app/lib/fx/dukascopyAggregation.ts`
- Test: `web/tests/timeframe-aggregation.test.mjs`
- Test: existing FX contract/aggregation tests under `web/tests/fx-*.test.mjs`

**Interfaces:**
- `aggregateCandlesToTimeframe` accepts every generic catalog ID and handles `15m`, `30m`, `4h`, and `1mo`.
- FX aggregation accepts every FX catalog ID, uses fixed UTC-aligned intraday buckets, session-aware D1/W1, and calendar-aware MN; fixed-duration arithmetic is not used for MN boundaries.
- Existing OHLCV null-volume and no-input semantics remain unchanged.

- [ ] **Step 1: Add failing generic aggregation cases** for 15-minute, 30-minute, 4-hour, and cross-month monthly bars, including volume/turnover completeness.
- [ ] **Step 2: Add failing timezone/DST cases** proving monthly buckets follow the requested timezone and intraday buckets do not collapse distinct DST fallback hours.
- [ ] **Step 3: Add failing FX cases** for M15/M30/H4/MN, rollover at 17:00, week boundaries, and incomplete monthly bucket calculation.
- [ ] **Step 4: Run only the aggregation and FX tests** and record the expected failures before implementation.
- [ ] **Step 5: Implement the smallest catalog-driven bucket and aggregation changes**; keep source arrays immutable and do not fill missing buckets.
- [ ] **Step 6: Replace FX fixed-millisecond assumptions for calendar periods** in completeness, next-bucket, and gap calculations.
- [ ] **Step 7: Run all aggregation/FX tests** and confirm pass before touching UI or routes.

### Task 3: Align provider, market-sync, and data-task contracts

**Files:**
- Modify: `web/app/lib/marketDataProviders.ts`
- Modify: `web/app/lib/marketSync.ts`
- Modify: `web/app/api/data-providers/route.ts`
- Modify: `web/app/api/data-jobs/route.ts`
- Modify: `web/app/api/data-jobs/run/route.ts`
- Test: `web/tests/market-data-providers.test.mjs`
- Test: `web/tests/market-sync-batching.test.mjs`
- Add/extend: `web/tests/timeframe-provider-contract.test.mjs`

**Interfaces:**
- Request validation recognizes exactly the nine catalog IDs.
- Provider metadata continues to report only true direct provider support; it does not claim that every catalog ID is directly downloadable.
- Provider request builders reject a catalog period that the provider cannot fetch directly, while local derivation remains a separate path.

- [ ] **Step 1: Add failing contract tests** for all nine accepted IDs, invalid-ID rejection, and direct-provider rejection for unsupported granularities.
- [ ] **Step 2: Add failing batch-plan tests** proving timeframe is carried through without changing symbol/session budgeting.
- [ ] **Step 3: Run the focused provider and sync tests** and confirm the new assertions fail.
- [ ] **Step 4: Replace scattered timeframe unions and literal validation sets** with the shared catalog type and provider-specific direct-capability sets.
- [ ] **Step 5: Keep Tushare/Alpaca request mappings limited to their real direct intervals** and return the existing API error shape for unsupported direct requests.
- [ ] **Step 6: Run provider, sync, and contract tests** and confirm pass.

### Task 4: Make candle catalog and snapshot views availability-safe

**Files:**
- Modify: `web/app/api/candles/route.ts`
- Modify: `web/app/api/snapshots/route.ts`
- Modify: `web/app/lib/timeframeView.ts`
- Test: `web/tests/data-snapshots.test.mjs`
- Test: `web/tests/timeframe-view.test.mjs`
- Add/extend: `web/tests/timeframe-api-availability.test.mjs`

**Interfaces:**
- Instrument catalog responses preserve actual `timeframes` from database/local data and never replace them with a hardcoded daily/weekly fallback that falsely marks data as available.
- Snapshot requests validate the shared nine-period contract and use rank-based aggregation checks, including the calendar-month lookback path.
- A target without direct data and without a valid smaller source returns the existing no-data response path and does not write a ready snapshot or coverage row.

- [ ] **Step 1: Add failing route-contract tests** for daily-only instruments retaining all-nine display metadata at the UI boundary but exposing only D1 as available.
- [ ] **Step 2: Add failing snapshot tests** for valid M15/H4/MN targets from lower source data and rejection when the source is daily-only for an intraday target.
- [ ] **Step 3: Run the focused snapshot/API tests** and confirm failure.
- [ ] **Step 4: Update candle catalog merging** to preserve actual coverage and use the shared period validity helpers.
- [ ] **Step 5: Update snapshot direct-read lookback and aggregation selection** for `1mo`, rank comparison, and no-source rejection while preserving snapshot metadata format.
- [ ] **Step 6: Run data-snapshot, timeframe-view, and API contract tests** and confirm pass.

### Task 5: Update TrainingWorkbench and all user-facing selectors

**Files:**
- Modify: `web/app/components/TrainingWorkbench.tsx`
- Modify: `web/app/features/settings/components/SettingsPanel.tsx`
- Modify: `web/app/features/review/components/SessionHistoryPanel.tsx`
- Modify: `web/app/features/settings/settingsContracts.ts`
- Test: `web/tests/mobile-ui.test.mjs`
- Test: `web/tests/settings-controller.test.mjs`
- Test: `web/tests/settings-gateway.test.mjs`
- Add/extend: `web/tests/timeframe-ui-availability.test.mjs`

**Interfaces:**
- Desktop and mobile chart bars render the full catalog labels, while the current instrument's unavailable IDs render disabled and grey.
- Training setup `<select>` renders all nine options with unavailable options disabled; instrument changes resolve to the first available ID and never leave an unavailable selected value.
- Random training candidate selection, default settings, restore, resume, and review filters use the shared IDs and availability instead of assuming every catalog period is selectable.

- [ ] **Step 1: Add failing source/UI tests** that assert all nine labels are rendered and daily-only instrument controls contain disabled unavailable items rather than filtering them out.
- [ ] **Step 2: Add failing tests** that assert unavailable period interaction does not call snapshot loading or set a rule notice; disabled styling is the only user-visible state.
- [ ] **Step 3: Run the focused UI/settings tests** and confirm failure.
- [ ] **Step 4: Replace `currentAvailableTimeframes`/`setupAvailableTimeframes` filtering at render sites** with full catalog iteration plus a set-membership disabled check.
- [ ] **Step 5: Apply shared labels to settings, review, and performance selectors** and keep legacy persisted values readable.
- [ ] **Step 6: Guard random, restore, and direct period changes** with silent unavailable checks and first-available fallback.
- [ ] **Step 7: Run mobile, settings, review, and timeframe UI tests** and confirm pass.

### Task 6: Update market-data maintenance and FX target controls

**Files:**
- Modify: `web/app/features/market-data/components/DataSourceManager.tsx`
- Modify: `web/app/features/market-data/components/FxDataControlPanel.tsx`
- Modify: `web/app/lib/fxDataService.ts`
- Test: `web/tests/fx-m1-support.test.mjs`
- Test: `web/tests/data-auto-update.test.mjs`
- Add/extend: `web/tests/fx-timeframe-targets.test.mjs`

**Interfaces:**
- FX initialization and update requests carry the complete nine-period target set, with M1 as raw source and lower-period data as the aggregation base.
- FX task persistence, progress, completeness, and incremental refresh cover new target periods without using a fixed duration for MN.
- CN/US maintenance controls show the common period catalog where a timeframe choice exists, but unavailable provider/source periods remain disabled rather than being submitted.

- [ ] **Step 1: Add failing FX target tests** for the nine target IDs and for MN recalculation across a month boundary.
- [ ] **Step 2: Add failing maintenance UI assertions** for complete period rendering and disabled unsupported choices.
- [ ] **Step 3: Run the focused FX and maintenance tests** and confirm failure.
- [ ] **Step 4: Extend FX target normalization and both historical/incremental higher-period generation** to M15/M30/H4/MN.
- [ ] **Step 5: Update task status/completeness calculations** to use bucket boundaries for calendar periods.
- [ ] **Step 6: Replace maintenance-period literals with catalog-derived options and provider capability checks**.
- [ ] **Step 7: Run FX, auto-update, and maintenance tests** and confirm pass.

### Task 7: Integration verification and CodeGraph review

**Files:**
- Modify only if needed: affected files from Tasks 1–6
- Test: all affected `web/tests/*.test.mjs`

- [ ] **Step 1: Run the focused aggregate, availability, snapshot, provider, FX, UI, settings, review, and maintenance tests together.**
- [ ] **Step 2: Run `cd web; npm run typecheck` and fix only errors caused by this feature.**
- [ ] **Step 3: Run `cd web; npm run lint`, `cd web; npm run test:unit`, and `cd web; npm run build`.**
- [ ] **Step 4: Run `cd web; npm run verify` and the compatible `cd web; npm test`; classify any baseline failures before changing unrelated code.**
- [ ] **Step 5: Run `git diff --check` and inspect the diff for accidental edits to existing user changes.**
- [ ] **Step 6: Refresh CodeGraph and run status/query/callers/callees/impact for the shared catalog, aggregation functions, `TrainingWorkbench`, snapshot route, and `executeBarStep`.**
- [ ] **Step 7: Perform the relevant local-data smoke checks:** daily-only A/US instrument shows nine labels with only real coverage enabled; an instrument with lower-period data can load an aggregated higher period; no real external synchronization is initiated.

## Verification Matrix

| Requirement | Primary evidence |
|---|---|
| Nine labels always display | `timeframe-ui-availability.test.mjs`, mobile UI test, smoke check |
| Missing periods only grey/disabled | UI source test and rendered selector assertions |
| Daily-only A/US is not reverse-aggregated | snapshot/API availability test and local-data smoke check |
| M15/M30/H4/MN aggregate correctly | generic and FX aggregation tests |
| All timeframe APIs share one contract | provider, data-job, candle, snapshot contract tests |
| Existing sessions/snapshots remain readable | settings gateway, review, snapshot regression tests |
| No schema/trading rule changes | diff review, CodeGraph impact review, build/test verification |
