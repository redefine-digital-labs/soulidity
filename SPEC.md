# Souls Latest Release And Atomic Price Spec

## Goal

一次性收口 Souls 最新 release 与价格语义，消除基于镜像插入顺序猜“最新版本”的逻辑，以及基于 `Int cents` / `BigInt` 的不完整 `u64` 存储。

## Scope

- Souls 公共详情、列表、我的 Souls、社区资料、agent detail 的 release/price 返回结构
- Souls 前端页面与卡片的 latest release 与价格展示/购买逻辑
- Souls 价格镜像写入、prepared purchase 金额持久化、Prisma schema 与迁移
- 相关测试与仓库契约

## Non-Goals

- 不做历史数据迁移兼容
- 不保留旧 API price number/cents 语义兼容层
- 不保留通过 `releases[0]` 推断最新 release 的旧逻辑

## Constraints

- Souls 和用户都是开发数据，可直接替换数据模型
- 数据库层需要完整承载 `u64`，不能使用 `BIGINT`
- API 边界不能直接暴露 `bigint` / Prisma Decimal，统一输出字符串

## Acceptance

1. 所有 Souls 购买与展示逻辑只从 canonical `latestRelease` 读取最新 release，不再依赖 `releases[0]`。
2. `oneTimePriceUsdc`、`subPriceUsdc`、`amountUsdc` 在数据库中可完整承载 `u64`，且服务端内部计算保持精确。
3. Souls 相关 API 对外统一返回 atomic USDC 字符串，不再返回 cents number。
4. 前端展示与购买逻辑基于 atomic 字符串工作，不再依赖页面临时链上价格 fallback。
5. 相关旧注释、旧类型、旧契约测试同步清理。
6. 手动发布 release 页面上传加密 bundle 后，`sealDekEnvelope` 必须随 mirror 请求传到后端并持久化为 release `sealSidecar`，agent access 不能再因为该链路丢字段而返回 `sealSidecar: null`。
7. Agent Souls access 在扫描多个 candidate pass 时，只要出现任一瞬时链上校验失败且最终没有任何 pass 被确认为有效，就必须返回可重试错误，不得因为后续非瞬时失败把结果误降级为 403。
8. USDC coin selection 不能因为固定页数上限把“余额足够但分页很深”的钱包误判为资金不足；只有在真正扫完整个分页后仍不够，才允许返回 insufficient funds。
9. Agent purchase/renew execute 路由必须在链上广播前校验 prepared record 的语义边界：purchase execute 只能接受非 renewal 的 prepared 记录，renew execute 只能接受带 `passOnChainId` 的 renewal prepared 记录；错误路由不得执行交易并不得把 prepared 记录终结到不可恢复状态。
10. Agent purchase/renew execute 在链上交易已成功且 `passOnChainId` 已可确定时，若后置链上校验或读链暂时失败，必须把 prepared 结果持久化为可恢复状态，并允许后续同一个 `preparedPurchaseId` 重新跑 verify + DB sync，不得把 5xx 暂时错误写成永久终态。
11. `takeRateLimitToken` 在 Upstash 调用异常时必须自动降级到现有 in-memory limiter，不能把 Redis/网络抖动直接放大成认证、购买、发布等主路径的 500。
12. `publish` / `release` mirror 路由在 release 依赖 `sealSidecar` 时，只有在 sidecar 成功持久化后才能写入成功 tx-sync；若 Seal sidecar 生成失败，接口必须返回可重试错误，且同一个 `txDigest` 后续可重新补 sidecar，不得缓存 201 成功结果。
13. Agent purchase/renew execute 对已存储的 retryable 结果做补 sync 时，必须重新执行与主执行路径相同的 pass invariants 校验；若 series/owner/release/pass type/renew pass context 不匹配，必须把 prepared 结果终结为 422，而不是继续写入本地 pass mirror。
14. Pass mirror 写入前必须把链上 owner 地址规范化后再用于 wallet binding 查找和 `soulPassSnapshot.ownerAddress` 落库，避免等价 Sui 地址因为格式差异丢失 `ownerMemberId` 或导致 owner-scoped 查询漏匹配。
