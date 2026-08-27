# 黄金现货数据与训练回放接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现货 XAU/USD 接入现有 EUR/USD 历史导入、Twelve Data M1 增量、覆盖管理和训练回放链路。

**Architecture:** 在现有 FX 数据契约中增加独立的 GOLD 目录与通用 resolver，保留 FX 专用目录和 FX 成交规则不变。数据服务继续复用 `fx_data_tasks` 与现有 M1/聚合/幂等写入，界面通过参数化的现有控制面板暴露黄金入口；训练工作台通过已有 candles 目录与真实周期覆盖自动获得黄金。

**Tech Stack:** Next.js/Vite, React, TypeScript, SQLite/D1-compatible SQL, Node test runner, CodeGraph.

**Spec:** `docs/superpowers/specs/2026-08-27-gold-market-data-design.md`

## Global Constraints

- 逻辑品种使用 `XAUUSD.GOLD`，Dukascopy 使用 `XAUUSD`，Twelve Data 使用 `XAU/USD`。
- M1 是唯一原始写入粒度；M5 及以上周期只能由同一品种较小周期聚合。
- 不新增数据库表或字段，不修改快照格式、交易执行规则或外部供应商语义。
- 黄金不复用 FX 的保证金、合约大小、点值和手数规则；本阶段只保证数据与回放链路。
- 测试不得执行真实外部下载或真实供应商同步。
- 必须保留当前工作区已有用户改动，不使用 reset/checkout 覆盖它们。

### Task 1: 黄金目录与解析契约

**Files:**
- Modify: `web/app/lib/fxDataContracts.ts`
- Create: `web/tests/gold-data-contracts.test.mjs`

**Interfaces:**
- Produce `GoldInstrumentId`, `GoldInstrumentDefinition`, `GOLD_INSTRUMENT_CATALOG`, `MarketInstrumentId`, `MarketInstrumentDefinition`, `MARKET_INSTRUMENT_CATALOG`, `normalizeMarketInstrument`, `getMarketInstrumentDefinition`.
- Preserve `FX_INSTRUMENT_CATALOG`, `normalizeFxInstrument`, and `getFxInstrumentDefinition` as FX-only APIs.

- [ ] Write failing tests for `XAUUSD.GOLD`, `XAUUSD`, `XAU/USD`, market metadata, provider symbols, and rejection of unsupported metals.
- [ ] Run `node --test tests/gold-data-contracts.test.mjs` and confirm failure because the GOLD APIs do not exist.
- [ ] Implement the smallest catalog/resolver extension while preserving FX-only behavior.
- [ ] Run the focused contract tests and existing `tests/fx-contracts.test.mjs`.

### Task 2: 数据服务与 API 任务链路

**Files:**
- Modify: `web/app/lib/fxDataService.ts`
- Modify: `web/app/api/fx-data/route.ts`
- Modify: `web/app/api/fx-data/initialize/route.ts`
- Modify: `web/app/api/fx-data/update/route.ts`
- Modify: `web/app/api/fx-data/run/route.ts`
- Modify: `web/app/api/fx-data/task/route.ts`
- Create or modify: `web/tests/gold-data-service.test.mjs`

**Interfaces:**
- `createFxTask`, `getFxTask`, `runFxTask`, and task view accept `MarketInstrumentId` values while retaining their route names and database table.
- `getFxCatalog(market = "FX")` returns only the requested market catalog.
- `ensureInstrument` writes the resolver-provided market (`FX` or `GOLD`).

- [ ] Add failing tests for gold task creation, market-filtered catalog, and instrument persistence metadata using the repository's existing fake D1 patterns.
- [ ] Run the focused service tests and capture the expected failure.
- [ ] Replace FX-only resolution/typing in the shared data service with market resolution; keep all existing source, cursor, retry, chunk, and aggregation behavior unchanged.
- [ ] Update API messages and optional market query handling without changing request/response shapes used by the FX page.
- [ ] Run focused gold/FX data service tests.

### Task 3: 黄金数据维护界面

**Files:**
- Modify: `web/app/features/market-data/components/FxDataControlPanel.tsx`
- Modify: `web/app/features/market-data/components/DataSourceManager.tsx`
- Modify: `web/app/features/market-data/marketDataGateway.ts`
- Create or modify: `web/tests/gold-data-ui.test.mjs`

**Interfaces:**
- Keep existing `FxDataControlPanel` export and FX defaults; add optional dataset copy/market configuration so the same component can render GOLD without FX-only wording.
- Add `DEFAULT_GOLD_INSTRUMENTS` containing `XAUUSD.GOLD` and pass it from `DataSourceManager`.

- [ ] Add failing source-contract tests asserting GOLD renders the real panel, uses the gold instrument, and loads the gold task rather than the latest unrelated FX task.
- [ ] Run the focused UI test and confirm failure against the unavailable placeholder.
- [ ] Enable GOLD in task loading, polling, actions, and refresh lifecycle; use `pairId=XAUUSD.GOLD` when resolving the gold task.
- [ ] Render the parameterized panel for GOLD and preserve the current FX panel behavior.
- [ ] Run focused UI tests plus existing FX/M1 UI tests.

### Task 4: 后台自动更新与训练目录验收

**Files:**
- Modify: `web/app/lib/dataAutoUpdateService.ts`
- Modify: `web/local-data/background-auto-update.mjs`
- Modify only if tests expose a real gap: `web/app/components/TrainingWorkbench.tsx`, `web/app/api/candles/route.ts`, `web/app/api/snapshots/route.ts`
- Create or modify: `web/tests/gold-auto-update.test.mjs`

**Interfaces:**
- `inspectExistingMarkets` returns a real `markets.GOLD` result with `duePairIds` and uses the same Twelve Data M1 status check.
- Background auto-update processes GOLD due ids through the existing `/api/fx-data` task routes.

- [ ] Add failing tests for GOLD coverage detection, Twelve Data symbol resolution, and background GOLD dispatch.
- [ ] Run the focused auto-update tests and confirm failure.
- [ ] Implement GOLD inspection and dispatch without changing CN/US/FX scheduling semantics.
- [ ] Verify that existing instrument catalog, timeframe availability, snapshots, and training M1 loading already work for `market=GOLD`; only add narrowly-scoped fixes if a test proves a gap.
- [ ] Run focused auto-update, catalog, timeframe, snapshot, and training tests.

### Task 5: 全局验证与影响范围复查

**Files:**
- Modify only if verification finds a feature-caused issue.

- [ ] Run all focused tests affected by the changed modules.
- [ ] Run `cd web; npm run typecheck`, `npm run lint`, `npm run test:unit`, and `npm run build`.
- [ ] Run `cd web; npm run verify`, compatible `npm test`, and `git diff --check`; classify only pre-existing failures.
- [ ] Run `codegraph status`, `codegraph affected` for changed files, and recheck callers of the market resolver/task entrypoints.
- [ ] Inspect the final diff for accidental edits to the existing dirty worktree and report any remaining concern.
