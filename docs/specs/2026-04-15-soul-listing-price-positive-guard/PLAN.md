# Soul Listing Positive Price Guard Plan

1. 先把规则改成可验证的红测试。
   - 把 Move 协议测试从 `list_soul_zero_price_succeeds` 改为 `price == 0` 失败。
   - 把 `soulidity-tx-builders`、`sell-flow-regression`、`agent-purchase-prepare-route` 中零价通过路径改成拒绝预期。
2. 再最小修改实现。
   - 在 `move/soulidity/sources/market.move` 的 Soul 上架入口补 `assert!(price > 0, EInvalidPrice)`。
   - 在 `web/lib/soulidity/tx/list.ts`、`web/lib/hooks/use-list-soul.ts`、`web/app/souls/[id]/sell/**` 收紧为正数校验。
   - 删除 `buildBuySoulTx` 的零支付特判，避免后续链路继续为非法状态兜底。
3. 最后同步文档并验证。
   - 更新 [docs/plans/e2e-test-plan.md](/Users/admin/Desktop/nao/clawnews/docs/plans/e2e-test-plan.md) 的价格约束描述。
   - 清理仓库内仍宣称 Soul 可零价上架的相关计划/规格文档。
   - 运行定向 Move / Vitest 验证，确认 Acceptance 1-4。
