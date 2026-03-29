# Soul Stablecoin Fixed-Price Hard Cut Plan

1. 先改链上模型与公开 ABI。
   - 在 `move/soul_object::market` 的 TransferPolicy 初始化里加入 `kiosk_lock_rule`、`personal_kiosk_rule` 和 `witness_rule<MarketOnlyProof>`。
   - 给 `Soul` 增加 `creator_royalty_bps`，把报价与购买结算统一到 `price + platform fee + creator royalty`。
   - 在 `move/soul_market_adapter::market` 中把发布、报价、购买、持有、重上架统一到 personal kiosk 托管 + stablecoin fixed-price 路径，测试网支付币固定为 `test_usdc::USDC`。
   - 删除旧 royalty/platform-fee rule 依赖和旧 marketplace 假设。
   - 为 owner Seal approval 增加经 kiosk 借用 `&Soul` 的入口，避免继续要求地址直持有对象。
2. 再改运行时数据模型与链上校验。
   - Prisma / repository / types / post-tx-db 改成记录 `currentKioskId`、`listingObjectOnChainId`、`listedPriceAtomic`、`creatorRoyaltyBps` 等稳定币成交字段。
   - on-chain verification 补充 listing object、creator royalty、kiosk owner / personal kiosk owner 解析，去掉“held 就是 address owner”的假设。
   - tx builder、purchase quote、prepared purchase、购买镜像、allowlist 镜像、access resolver 全部切到 kiosk 持有 + stablecoin fixed-price 模型。
3. 最后收口页面、测试和验证。
   - 详情页、购买按钮、发布页、重上架、allowlist、下载入口按 kiosk 持有 + USDC 计价模型调整。
   - 修正 Move/Web 测试，删除旧的 address-owned、`*Sui` 字段和旧 adapter package 假设。
   - 运行 `npm run typecheck`、`npm test`、`sui move test --path move/soul_object`、`sui move test --path move/soul_market_adapter`。
