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
10. 跑相关测试与 typecheck，确认无残留。
