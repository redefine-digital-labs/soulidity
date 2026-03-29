# `fluffy-mapping-cerf` 仓库体检文档审查意见（2026-03-24）

## 背景

- 审查对象：`/Users/admin/.claude/plans/fluffy-mapping-cerf.md`
- 审查范围：仅核对该文档结论与当前仓库事实是否一致，不改写原始文档，也不把本文件当实施计划。
- 审查方式：静态核对源码、`prisma/schema.prisma`、现有测试与 `TODO.md`；未做压测、渗透测试或生产流量分析。

## 结论摘要

这份文档目前不能直接当执行计划使用。它更像一份“仓库体检速记”：里面同时混有真实问题、过时结论、误判，以及尚未完成决策的动作项。

核心问题不是“发现得不够多”，而是“问题类型没有分层”。如果按原文直接排期，后续实现会同时受到错误优先级、错误工时预估和不完整验收条件的影响。

## 主要问题

### 1. `web/lib/coingecko.ts` 被误判为“完全死代码”

- 问题：原文把 `web/lib/coingecko.ts` 认定为 `completely unused`，并列入 quick win 删除项。
- 原文位置：`/Users/admin/.claude/plans/fluffy-mapping-cerf.md:12`、`:97`
- 仓库证据：
  - `web/lib/coingecko.ts:24` 导出可调用函数 `getCoingeckoUsdPrice`
  - `tests/web/coingecko-price.test.ts:3` 直接导入该模块
  - `tests/web/coingecko-price.test.ts:17-78` 对缓存、错误路径、并发去重都有覆盖
- 为什么这会误导后续实施：这不是“完全未使用”，最多只能说“运行时引用尚未确认”。直接删除会先打破测试契约，再迫使后续重新判断是否保留该 utility。

### 2. DB index 结论混入了已过时项

- 问题：原文把 `pipelineStatus`、`Post.tags`、`SoulPassSnapshot.expiresAt` 打包称为 “Missing DB indexes”。
- 原文位置：`/Users/admin/.claude/plans/fluffy-mapping-cerf.md:50`、`:105`
- 仓库证据：
  - `prisma/schema.prisma:40-58` 中 `Article.pipelineStatus` 确实没有索引
  - `prisma/schema.prisma:185-204` 中 `Post.tags` 也没有索引
  - `prisma/schema.prisma:350-373` 中 `SoulPassSnapshot` 已有多组复合索引，并非“完全无索引背景”
- 为什么这会误导后续实施：真实缺口和旧结论被揉在一起，会让后续 migration 优先级失真。索引建议应当绑定实际查询路径，而不是按字段名打包罗列。

### 3. 缓存问题表述过宽，并且 producer 并发瓶颈定位到错文件

- 问题：原文把 `45+ API routes` 统一归类为“无缓存头”，并把 producer 串行瓶颈写成 `src/producer/run.ts:17`。
- 原文位置：`/Users/admin/.claude/plans/fluffy-mapping-cerf.md:38-40`
- 仓库证据：
  - `web/app/api/**` 下既有只读接口，也有写接口、鉴权接口、agent 接口，不能一刀切加缓存
  - `src/producer/run.ts:14` 只是调用 `produceArticles(prisma, llm)`
  - 真正的并发默认值在 `src/producer/produce.ts:7`，默认 `concurrency = 1`
- 为什么这会误导后续实施：缓存应当先列出允许缓存的只读端点白名单；producer 并发优化也应该指向正确实现点，否则连修改入口都会找错。

### 4. agent 路由 rate limit 的问题表述失真

- 问题：原文称“Agent API routes lack middleware-level rate limiting”。
- 原文位置：`/Users/admin/.claude/plans/fluffy-mapping-cerf.md:72`、`:112`
- 仓库证据：
  - `web/lib/auth/require-agent-api-key.ts:12-31` 已对失败鉴权做限流
  - 多个 agent 路由本身已有 `takeRateLimitToken(...)` 保护
  - 当前真正的系统性缺口已在 `TODO.md:3-4` 记录：限流后端仍是单机内存态，无法跨 Vercel 实例共享
- 为什么这会误导后续实施：问题不在“有没有 rate limit”，而在“rate limit 是否具备多实例一致性”。如果继续用 middleware 视角描述，会把后续工作引到错误层级。

### 5. prepared purchase “缺 timestamp check” 的论证不足

- 问题：原文把 `Prepared purchase signature has no timestamp check` 直接列为中风险。
- 原文位置：`/Users/admin/.claude/plans/fluffy-mapping-cerf.md:79`
- 仓库证据：
  - `web/lib/souls/prepared-purchase.ts:67-83` 预购记录本身带 TTL
  - `web/lib/souls/prepared-purchase.ts:221-227` 过期未完成记录不会继续返回
  - `web/lib/souls/prepared-purchase.ts:264-339` 执行前有原子 claim
  - `web/app/api/agent/souls/[id]/purchase/execute/route.ts:149-168` 还有 tx bytes hash 和签名校验
- 为什么这会误导后续实施：当前系统已经存在 replay 防护链路。是否还要补 timestamp，需要在现有模型上继续论证；不能把“没有 timestamp”直接等价成“存在 replay 风险”。

### 6. tags 迁移被严重低估为“半天重构”

- 问题：原文把 tags 从 CSV 迁移到 junction table 估成 `half-day each`。
- 原文位置：`/Users/admin/.claude/plans/fluffy-mapping-cerf.md:111`
- 仓库证据：
  - `web/app/api/community/posts/route.ts:16-22` 读路径依赖 CSV 搜索
  - `web/app/api/community/posts/route.ts:48-68` 写路径依赖 CSV 归一化
  - `web/app/api/community/tags/route.ts:7-20` tags 聚合接口依赖 CSV
  - `web/app/community/page.tsx`、`web/app/community/[id]/page.tsx`、`web/app/u/[id]/page.tsx` 都在读 CSV tags
- 为什么这会误导后续实施：这是跨 schema、API、页面和测试的公共契约变更，不是单点重构。更合理的拆法应当是“先补输入约束，再评估存储模型迁移”。

### 7. 文档本身不是 decision-complete plan

- 问题：文档里仍然存在 `Remove or implement` 这类未决策动作，且缺少验收、回滚点、测试映射和“哪些项仅为怀疑”的标记。
- 原文位置：`/Users/admin/.claude/plans/fluffy-mapping-cerf.md:15`、`:94-114`
- 仓库证据：
  - `SESSION_SECRET` 仍被写成二选一动作，而不是确定方案
  - 全文只有问题列表和时间桶，没有说明完成条件
- 为什么这会误导后续实施：这类文档适合做审计草稿，不适合直接派工。实现者会被迫在执行时二次做产品/架构决策，结果不可控。

## 仍然成立、建议保留的问题

下列方向经静态核对后，仍然成立，适合保留为后续修复候选：

- GitHub collector 缺 fetch timeout
  - 证据：`src/collector/github.ts:24-40`

- comment / post 缺内容长度上限
  - 证据：`web/app/api/community/posts/[id]/comments/route.ts:17-25`
  - 证据：`web/app/api/community/posts/route.ts:43-70`

- Privy email 使用前未见 `verified` 判断
  - 证据：`web/lib/auth/identity.ts:323-358`
  - 证据：`web/app/api/register/route.ts:85-94`
  - 证据：`web/app/api/agent-join/claim-register/route.ts:72-76`

- members / invites 无分页
  - 证据：`web/app/api/members/route.ts:9-13`
  - 证据：`web/app/api/invites/route.ts:6-11`

- community tags 查询全表扫描
  - 证据：`web/app/api/community/tags/route.ts:7-20`

- comment 创建与 commentCount 自增未放进同一事务
  - 证据：`web/app/api/community/posts/[id]/comments/route.ts:21-33`

## 不应直接据此排期的项

以下条目不适合按原文现状直接进入实现排期：

| 项目 | 当前状态 | 原因 |
|------|----------|------|
| 全量 API 缓存 | 需要先筛只读白名单 | 写接口、鉴权接口和 agent 接口不能按“45+ 路由”统一处理 |
| tags 存储模型迁移 | 需要先拆阶段 | 这是公共契约变更，不能按半天小改估算 |
| agent route rate limiting | 需要先改问题定义 | 真缺口是共享限流后端，不是单纯 middleware 层缺失 |
| prepared purchase replay 防护增强 | 需要先补论证 | 现有 TTL、claim、hash、签名校验已构成防护链 |
| DB index 补充 | 需要按查询路径逐条确认 | 不能把真实缺口和过时结论打包做 migration |

## 验证边界

本次审查已完成：

- 源码静态核对
- `prisma/schema.prisma` 静态核对
- 相关测试静态核对
- `TODO.md` 现有债务项交叉核对

本次审查未完成：

- benchmark / profiling
- 真实流量分析
- 渗透测试
- 生产环境行为验证
- 攻击路径复现

因此，本文对“事实错误”和“证据不足”的判断可信度较高；对“性能严重度”和“安全严重度”的绝对排序，仍应视为基于代码形态的工程判断，而不是实测结果。
