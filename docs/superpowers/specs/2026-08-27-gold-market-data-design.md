# 黄金现货数据与训练回放接入设计

## 目标

将 XAU/USD 现货按现有 EUR/USD 数据任务链路接入：Dukascopy 负责历史 1 分钟数据，Twelve Data 负责已收盘 M1 增量；M1 写入现有 candles/candle_coverage 表，并由现有黄金数据覆盖目录、周期筛选和训练回放读取。

## 范围

- 新增稳定品种标识 `XAUUSD.GOLD`，展示名为 `XAU/USD`。
- Dukascopy 历史供应商代码为 `XAUUSD`。
- Twelve Data 增量供应商代码为 `XAU/USD`，固定请求 `1min`。
- 复用 `fx_data_tasks` 任务表、断点、分片、自动重试、暂停/恢复、质量统计和幂等写入逻辑；不新增数据库表或字段。
- 黄金市场数据维护页面使用与 EUR/USD 相同的历史初始化、Twelve Data 增量、任务状态和九周期目标选择。
- 数据写入后由现有 `/api/candles?instruments=1` 目录自然暴露，训练工作台可选择黄金和真实可用周期，包括 M1。
- 后台自动更新检查已有黄金数据，并使用同一个 Twelve Data 增量任务入口。

## 不在本次范围

- 不把黄金当作 FX 计算点值、保证金、合约大小或手数规则。
- 不修改数据库 schema、迁移策略、快照格式或交易执行规则。
- 不为 COMEX/GC 期货建立第二套数据源；本次只接现货 XAU/USD。
- 不执行真实历史下载或真实 Twelve Data 同步作为测试步骤。

## 数据与规则约束

- 逻辑品种 `XAUUSD.GOLD` 必须带 `market = GOLD`，避免现有 `.FX` 判断把黄金误判为外汇。
- 黄金数据任务可以共享现有 FX 数据服务的存储和生命周期，但 resolver、目录和错误文案要能区分 FX 与 GOLD。
- M1 是唯一原始写入粒度；M5 及以上周期只能从同一品种较小周期聚合。
- 未配置 Twelve Data 时，历史初始化仍可执行；增量任务和后台检查应给出配置提示。
- Dukascopy 实际可用的最早时间由现有官方 availability 检查决定，用户输入的范围仍需保留并在任务进度/覆盖中体现真实结果。

## 验收标准

1. `XAUUSD.GOLD`、`XAUUSD`、`XAU/USD` 可解析为同一个 GOLD 目录项；未知品种不会被接受。
2. 创建黄金初始化任务会写入现有任务表，保存 `XAUUSD`/`XAU/USD` 两个供应商代码，并保留九个目标周期。
3. 执行黄金历史任务时，写入的 instruments.market 为 `GOLD`，M1/M5/更高周期的 instrument_id 均为 `XAUUSD.GOLD`。
4. 黄金增量任务请求 Twelve Data 的 symbol 为 `XAU/USD`、interval 为 `1min`，并可继续使用已有 cursor 与历史边界。
5. 黄金数据维护页出现可用初始化/增量控制，不再显示“尚未接入”；FX 页面现有行为不回归。
6. 有 GOLD 覆盖后，训练工作台品种目录可收到 `XAUUSD.GOLD`，并以真实覆盖启用 M1 回放。
7. 自动更新检查能识别 GOLD 数据和待更新的 `XAUUSD.GOLD`，后台任务会执行该品种。
8. 既有 FX、周期、快照、设置和训练测试继续通过。
