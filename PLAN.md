# Souls Latest Release And Atomic Price Plan

1. 先补失败测试，覆盖：
   - detail/list/profile/agent detail 返回 canonical `latestRelease`
   - one-time 购买不再使用 `releases[0]`
   - pricing mirror / prepared purchase 不再使用 `Int cents` / `BigInt`
2. 更新 Prisma schema 与新 migration：
   - Souls 价格与 prepared purchase amount 改为 `Decimal @db.Decimal(20,0)`
   - 清理相关注释与契约测试
3. 增加 Souls 价格序列化/反序列化 helper：
   - DB Decimal -> API string
   - API string -> 展示格式 / 业务 `bigint`
4. 收口后端 API：
   - 详情/列表/profile/my/agent detail 显式返回 `latestRelease`
   - 路由不再用 `releases[0]` 代表最新版本
5. 收口前端：
   - SoulCard / SoulDetail / PurchaseButton / SoulPricing 改为 atomic price string + canonical latest release
   - 删除旧 cents 语义与链上 plan price fallback
6. 收口手动 release mirror / agent access follow-up：
   - 手动 release 页面传递 `sealDekEnvelope`，后端复用统一 helper 持久化 `sealSidecar`
   - agent access 记录任一 retryable pass 校验失败，避免被后续 4xx/403 覆盖
7. 收口 coin selection follow-up：
   - 去掉分页扫描的 10 页硬上限，改为扫到分页结束
   - 对缺失/重复 cursor 的异常分页返回 distinct failure，避免误报余额不足
8. 收口 execute intent 边界 follow-up：
   - purchase execute 在读取 prepared record 后先拒绝 renewal intent（`passOnChainId` 已存在）
   - renew execute 在读取 prepared record 后先拒绝 purchase intent（`passOnChainId` 缺失）
   - 同步修正相关误导性注释，避免继续引导客户端走错 execute 入口
9. 收口 execute retry follow-up：
   - purchase/renew execute 对“链上已成功但 verify/read-chain 暂时失败”写入可恢复结果，保留 `passOnChainId`
   - stored result 的重试逻辑不再只认 `207`，也允许上述 retryable verification failure 重新完成本地 sync
10. 收口 rate-limit / sidecar retry follow-up：
   - `takeRateLimitToken` 对 Upstash `limit()` 异常降级到 in-memory limiter
   - `publish` / `release` mirror 把成功 tx-sync 延后到 sidecar 成功之后，sidecar 失败返回可重试错误
   - 同步补 retry 回归，确认同一 `txDigest` 不会因为过早缓存成功而失去修复机会
11. 收口 execute retry invariant follow-up：
   - purchase/renew execute 的 stored retry 分支复用主路径 pass-state 校验
   - 一旦确认 series/owner/release/pass context 不匹配，就把 prepared 结果终结为 422，而不是继续补本地 sync
   - 补 retry branch 回归，覆盖 purchase release mismatch 与 renew prepared-pass mismatch
12. 收口 pass owner normalization follow-up：
   - `dbCreatePass` 在 wallet binding lookup 和 snapshot upsert 前统一规范化 owner 地址
   - 补回归覆盖短地址/非规范地址输入，确认 `ownerMemberId` 解析与 `ownerAddress` 落库都使用规范值
13. 收口 renew owner / series metadata validation follow-up：
   - `dbRenewPass` 续费同步时同步刷新规范化后的 `ownerAddress` / `ownerMemberId`
   - agent/human renew 路由把 verified pass owner 透传给 `dbRenewPass`
   - `buildCreateSeriesTx` 前置拒绝空白 description，避免必败交易进入签名
   - 补回归覆盖 renew owner refresh 与 empty description validation
14. 跑相关测试与 typecheck，确认无残留。
15. 收口 Publish Soul 本地 draft 提交流程：
   - 提交前若 draft 尚未产生任何 on-chain progress，则用当前表单值刷新 `name` / `description` / pricing 等可编辑字段后再继续执行
   - 补回归覆盖“第一次空 description 失败后，修正输入再次提交不应继续使用旧空 draft”
