# Default Platform Fee 2.5% Spec

## Goal

把 Soulidity 市场配置的默认平台抽成从 `0 bps` 调整为 `250 bps`，使新初始化/新部署出来的 `MarketConfig.platform_fee_bps` 默认为 2.5%。

## Scope

- `move/soulidity/sources/market.move`
- `move/soulidity/sources/protocol_tests.move`
- 当前仓库内会明确误导“默认平台费为 0%”判断的非历史文档
- `docs/specs/2026-04-15-default-platform-fee-2_5pct/PLAN.md`

## Non-Goals

- 不自动修改当前 testnet 已部署 `MarketConfig` 的链上值
- 不新增 `Grant` 收费逻辑
- 不改动 `ContentAccessList` 购买分账逻辑本身，只调整默认费率来源
- 不清理历史归档文档（`docs/legacy/**`、原型稿等）

## Constraints

- 只改默认初始化值；管理员后续仍可通过 `update_platform_fee_bps` 覆盖
- 需要同步修正默认值断言与说明，避免代码和文档继续相互打架
- 结果里必须明确说明：代码默认值改为 2.5% 不会自动迁移当前链上共享对象

## Acceptance

1. `market::init_impl` 初始化 `MarketConfig` 时默认写入 `platform_fee_bps = 250`。
2. 依赖默认值的 Move 测试断言同步改为 250 bps。
3. 仓库内当前文档不再把 Soulidity 的默认平台抽成描述为 0%。
4. 验证能证明边界成立：现有已部署 testnet `MarketConfig` 仍保持当前链上值，不会因代码改动自动变更。
