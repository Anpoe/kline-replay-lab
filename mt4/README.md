# Always In Structure Alert（MT4）

`AlwaysInStructureAlert.mq4` 是一个只提醒、不交易的 MT4 EA。它读取当前图表的品种和周期，复刻训练程序中的严格结构版 `Always In Long` 与 `Always In Short`，只在已收盘 K 线上判断。

## 安装

1. 在 MT4 中打开 **文件 → 打开数据文件夹**，进入 `MQL4\Experts`。
2. 将 `AlwaysInStructureAlert.mq4` 复制到该目录。
3. 用 MetaEditor 打开文件并点击 **Compile**。如果编译器提示缺少历史数据，先让对应图表加载足够的 K 线。
4. 回到 MT4，把 EA 拖到任意外汇品种、任意时间周期的图表上。
5. 在 EA 属性中确认允许使用需要的通知渠道；默认会使用 MT4 弹窗和日志提醒，声音、Push、邮件可分别打开。

EA 使用挂载图表的 `Symbol()` 和 `Period()`，不限定 EURUSD 或 5 分钟。修改输入参数后，移除并重新挂载 EA 使初始化状态清晰生效。

## 提醒时机与冷却

新 K 线开出时，上一根 K 线刚刚完成，EA 才会评估它并提醒。因此提醒对应的是上一根已收盘 K 线，不会使用当前正在形成的 K 线；EA 刚挂载时也不会补发历史提醒。

Long 和 Short 共用一个全局 **10 根当前周期 K 线冷却**。连续多根 K 线仍处于 Always In 状态时，冷却期间只提醒一次；方向反转也不能绕过这段冷却。

## 输入参数

前九个结构参数与训练程序同名同义：EMA 周期、摆动点确认强度、突破跟进窗口、EMA 连续同向根数、状态回看、最近突破、控制窗口、均线同侧收盘数和允许的 EMA 穿越数。`InpCooldownBars` 固定为 10；如果改成其他值，EA 会拒绝初始化。`InpHistoryBars` 控制重建状态时读取的已收盘历史长度。

`InpEnableSound`、`InpEnablePush`、`InpEnableEmail` 只控制提醒渠道。Push 和邮件还需要先在 MT4 的通知/邮件设置中配置账号或服务器。

## 安全边界

这个 EA 不含 `OrderSend`、修改订单、关闭订单、挂单或持仓管理逻辑，永远不会代替你下单。Always In 只是方向状态提醒；入场位置、止损、目标和风险仍需你按自己的交易计划确认。

如果当前环境没有 MetaEditor，仓库中的 Node 合约测试和源码静态检查只能验证接口与“无交易 API”约束，不能替代你在 MT4 MetaEditor 中的实际编译。
