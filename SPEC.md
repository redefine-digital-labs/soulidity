# Soul Stablecoin Fixed-Price Hard Cut Spec

## Goal

一次性把 Soul 从“地址直持有 + 第三方市场假设 + SUI 命名残留”的半套模型，硬切成“始终由 personal kiosk 托管 + 自家 fixed-price 成交 + 单一稳定币结算 + allowlist/version-cap 在受支持转移路径里自动清空”的单一模型，不留 address-owned Soul、旧 Marketplace 假设和旧计价字段尾巴。

## Scope

- `move/soul_object/**`
- `move/soul_market_adapter/**`
- `prisma/**`
- `web/lib/souls/**`
- `web/lib/services/seal*.ts`
- `web/app/api/souls/**`
- `web/app/api/agent/souls/**`
- `web/app/souls/**`
- `web/components/souls/**`
- `tests/web/**`
- `SPEC.md`
- `PLAN.md`

## Non-Goals

- 不新增多地址 allowlist；仍然是 `owner + 1 个 allowlist 地址`
- 不做旧 address-owned Soul 的向后兼容逻辑
- 不做多币种或运行时切币；测试网固定沿用 `test_usdc::USDC`
- 不支持第三方 market offer / bid / seller-accept-offer
- 不扩展到 Soul 以外的其他资产模型

## Constraints

- Soul 交易本质仍是 NFT 交易，但仓库的受支持生命周期必须统一到 `always-in-kiosk + buyer-initiated fixed-price`
- 链上策略必须加入足够的 rule，使产品支持路径下的 Soul 在买入、持有、重上架过程中都不回到地址直持有状态，也不能被第三方市场确认成交
- human 与 agent 对 Seal 内容访问能力保持对称；差异只能在认证入口，不在 Soul 业务模型
- owner 自身访问与 allowlisted 地址访问都必须在 Soul 被 kiosk 托管时继续可用
- 内层权利继续沿用现有 `allowlist/version-cap`；不引入新的 license/token 体系
- 本轮是硬切，必须同步清理旧字段、旧假设、旧测试和误导性文案

## Acceptance

1. `move/soul_object::market` 的 TransferPolicy 对 `Soul` 启用 `kiosk_lock_rule`、`personal_kiosk_rule` 与 `witness_rule<MarketOnlyProof>`，并且活动交易路径能完成对应 prove / confirm。
2. `move/soul_market_adapter` 的发布、报价、购买、持有、再上架路径统一成 stablecoin fixed-price + personal kiosk 托管模型：
   - 发布后 Soul 在 creator personal kiosk 内上架
   - 购买后 Soul 在 buyer personal kiosk 内保管，而不是回到 buyer 地址直持有
   - 再上架从现有 kiosk 内的 Soul 出发，不再要求地址直持有 `Soul`
   - 测试网支付币固定为 `test_usdc::USDC`
3. `Soul` 本体持有不可变 `creator_royalty_bps`，默认 `0`；购买报价和结算显式拆分 `price + platform fee + creator royalty`，旧全局 royalty / platform fee rule 模块被移除。
4. Seal owner approval 不再直接假设 `&Soul` 来自地址持有对象；owner 在 Soul 被 kiosk 托管时仍可完成浏览器内下载解密。
5. Web/DB 运行时不再把 `held` 解释成“地址直持有”，并且不再使用旧 `*Sui` 价格字段：
   - owner 识别基于 personal kiosk owner
   - DB 存储当前托管 kiosk、`listingObjectOnChainId`、`listedPriceAtomic`，并保留 listed / held 两种产品态
   - 不再把 `sellerKioskId = null` 当作 held 的必要条件
   - prepared purchase、详情页报价和购买按钮统一使用 atomic 稳定币金额与 listing object
6. 购买、重上架会清空 allowlist 并 bump version；`cancel_listing` 不改变 owner 访问能力。
7. 购买、allowlist、access、我的 Souls、详情页、重上架按钮、agent prepared purchase 全部适配 kiosk 持有 + 稳定币购买模型。
8. 仓库当前活动代码中不再存在“购买后 transfer Soul 到 buyer 地址”“重上架必须传入地址持有 Soul 对象”或“继续依赖第三方市场 offer/bid”的主链路。
9. Move tests 与 Web tests 覆盖以下事实：
   - 购买后 Soul 由 buyer personal kiosk 托管
   - 持有态可从 kiosk 重上架
   - allowlist 在购买/重新上架等支持的转移路径中清空
   - 稳定币报价、支付与费用拆分正确
   - owner / allowlisted 均可在 kiosk 托管状态下完成 Seal 访问
10. 验证结果明确说明最终边界：产品支持路径下已消除 address-owned 尾巴与第三方市场成交尾巴；如果仍存在协议层无法钩住的外部裸转移边界，必须只剩明确、可解释的最小边界，而不是仓库内旧实现残留。
