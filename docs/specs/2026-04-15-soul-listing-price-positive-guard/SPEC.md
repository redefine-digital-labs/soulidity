# Soul Listing Positive Price Guard Spec

## Goal

收口 Soulidity 的 Soul 上架价格规则，确保 `Soul` 的 `listing price` 必须严格大于 `0`，不再允许免费上架路径，同时让协议、前端、测试和执行文档保持一致。

## Scope

- `move/soulidity/sources/market.move`
- `move/soulidity/sources/protocol_tests.move`
- `web/lib/soulidity/tx/**`
- `web/lib/hooks/use-list-soul.ts`
- `web/app/souls/[id]/sell/**`
- `web/app/api/agent/souls/[id]/purchase/route.ts`
- `tests/new-web/**`
- `docs/plans/e2e-test-plan.md`
- 当前仓库内仍声明 Soul 可 0 价上架的相关计划/规格文档

## Non-Goals

- 不调整 Collection right 的价格规则；它当前已要求 `> 0`
- 不改动通用金额解析器 `parseDisplayAmountToAtomic` 的语义
- 不扩展与本次价格约束无关的市场逻辑

## Constraints

- 必须先让测试表达“`0` 价非法”，再补实现
- 新规则确认替代旧规则后，同轮清理误导性的零价上架说明和回归测试
- 验证至少覆盖协议测试与受影响的 Vitest 测试

## Acceptance

1. `move/soulidity` 的 Soul 上架入口在链上拒绝 `price == 0`。
2. `buildListSoulTx`、`useListSoul` 和 sell 页面不再接受 `0` 价进入上架链路。
3. 零价 Soul 上架 / 购买相关测试改为拒绝或移除，受影响回归测试通过。
4. [docs/plans/e2e-test-plan.md](/Users/admin/Desktop/nao/clawnews/docs/plans/e2e-test-plan.md) 和仓库内相关计划文档不再宣称 Soul 可以 0 价上架。
