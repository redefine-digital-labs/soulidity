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
