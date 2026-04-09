# New Web Health Fixes Plan

1. 先补最小失败测试和规格锚点。
   - 为 agent API key 限流回退、community tags 新模型、skillVersions 收口、MarketConfig 缓存写回归测试。
   - 写 migration/assertion 测试覆盖 `Post.tags` 数组化与 GIN/手工索引登记。
2. 再替换批量导入 Excel 实现。
   - 抽出模板行归一化逻辑并保留现有校验。
   - 用新库实现 `.xlsx` 下载与读取，CSV 走轻量实现。
   - 去掉 `.xls` 接受面和 `xlsx` 依赖。
3. 再修安全与热路径。
   - 统一 agent 失败限流 key 回退链。
   - 抽 `MarketConfig` TTL 缓存，并替换 Soul/Collection/agent 详情等读路径。
4. 再收口 Soul skills 详情读取。
   - repository/detail 只取受限预览和总量。
   - `/api/souls/[id]/skills` 改成分页读取。
   - `SkillsPanel` 从独立接口加载并支持继续展开/加载更多。
5. 再做 community tags 模型迁移。
   - Prisma schema + migration + 索引。
   - new-web API / hooks / 页面改为数组 contract。
   - shared article sync 和 legacy community 编译兼容一起修。
6. 最后清理残留与升级依赖。
   - 删除孤儿类型声明。
   - 分批升级 package manifests 和 lockfiles。
7. 按 Spec 验收。
   - 跑相关测试、全量 typecheck、审计检查。
   - 对照 Spec Acceptance 逐条确认是否收口。
