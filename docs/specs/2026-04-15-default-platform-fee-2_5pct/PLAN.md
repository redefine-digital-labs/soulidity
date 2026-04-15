# Default Platform Fee 2.5% Plan

1. 先固定规格与边界。
   - 本轮只改默认初始化值，不触碰现有链上对象。
   - 以 Move 默认值断言和当前 testnet 对象读取结果作为验收证据。

2. 再修改协议默认值与测试。
   - 把 `market.move` 的 `platform_fee_bps` 初始化值从 `0` 改成 `250`。
   - 更新 `protocol_tests.move` 中依赖默认值的断言。

3. 最后修正文档并验证。
   - 更新当前非历史文档里“默认平台费 0%”的表述。
   - 运行针对性测试/检查。
   - 复读当前 testnet `MarketConfig`，确认它仍是既有链上值，边界说明成立。
