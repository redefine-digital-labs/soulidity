# Plan

1. Contract hard cut
   - 新增 `metadata.move` 与 metadata 事件
   - 从 `Soul` 删除 `metadata_ref`，在 `SoulState` 新增 `metadata_id`
   - 改造 mint / import / join 链路创建 metadata object
   - 删除旧 `set_soul_metadata_ref` / `delete_soul_metadata_ref`
   - 给 asset delete 加 active binding 护栏

2. Projection and query
   - Prisma schema / migration 改成 metadata object 投影字段
   - `queries.ts` / `events.ts` / `mirror/*` 改读 `SoulMetadata`
   - `repository.ts` / `types.ts` 去掉 `metadataRef`

3. Builder and sync routes
   - `tx/publish.ts` / `tx/import.ts` / `tx/personal-join.ts` 改传 initial metadata payload
   - `tx/metadata.ts` 改成 active binding / blob 管理 builder
   - publish / import / personal-join / `/api/souls/[id]/metadata` 改成 metadata object sync

4. Web and desktop consumers
   - `web/lib/soulidity/metadata.ts` 改为 mirrored on-chain metadata 解析
   - create / import / wrap / collection publish 去掉 metadata blob upload
   - desktop catalog / sprite contract / persona bundle / downloader 改按 metadata object + `download_policy` 工作

5. Closeout
   - 更新 smart-contract / SDK / desktop companion 文档
   - 删除旧 `metadata_ref` 叙述、测试和 dead path
   - 跑 `sui move build`、`sui move test`、`npm run prisma:generate`、相关 Vitest
