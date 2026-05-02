# Soul Content Storage Hard-Cut Plan

1. 先冻结本轮契约和测试基线。
   - 用最小失败测试锁定 Move 的 memory/skills 新对象与 event 结构。
   - 用最小失败测试锁定 Prisma projection、TypeScript types、event parser、route shape 的新复合键契约。
2. 再改 Move package。
   - 重写 `memory.move`、`skills.move`、`seal_policy.move`、`soul.move`、`market.move`。
   - 更新 `protocol_tests.move` 等 Move 测试，确认 fresh deploy 下 mint/publish/import/personal-join 可产出新 event。
3. 再改 DB 与 mirror/repository/query 层。
   - 修改 `prisma/schema.prisma` 与 migration。
   - 收口 `types.ts`、`events.ts`、`queries.ts`、`repository.ts`、`mirror/**`、`build-seal-sidecars.ts` 到新键模型。
4. 再改 memory 默认加密与 access API。
   - publish/import/personal-join/memory append 传 `rawMemoryEnvelope` 并构建 memory sidecar。
   - 新增 human/agent memory access route 与 `memory-access.ts`。
5. 再改 skills 多 skill + `.zip only`。
   - 上传校验读取 ZIP 内 `SKILL.md` frontmatter `name`。
   - 收口 append/list/access/delete route、tx builder、hook、skills panel、Soul detail 视图。
6. 最后做模板、资源页、文档和旧残留清理。
   - 新建 content schema / templates / resources 页面。
   - 更新 `docs/specs/soul-content-format.md`，删除旧字段/旧文案/旧断言。
7. 按 Spec 验收。
   - 运行 Move、new-web 测试、typecheck、build。
   - 对照 `SPEC.md` Acceptance 逐条确认，不留旧路由和旧字段尾巴。

## Audit Closeout Plan — 2026-05-02

1. 更新合约对象布局与权限语义。
   - `SoulState` active grant 索引切到 Table + count。
   - grant owner rotation 改成 lazy invalidation。
   - content access / metadata / asset / skill API 收口到绑定校验和 purge 语义。
2. 更新 Move 回归。
   - 覆盖 owner 自购、当前时间过期 grant、lazy invalidation、content access linkage、scope 校验、stale access cleanup、purge、post-mint skills root。
3. 更新 Web/TS ABI。
   - 删除 `register_existing_personal_kiosk` 调用。
   - 新增 cleanup / purge / init-skills / scope setter builders。
   - query parser 不再依赖 `active_grants` vector 或 content access mirror count 字段。
4. 更新资源页和合约文档。
   - 明确 grant 是 Table 索引、epoch-pinned、permissionless cleanup。
   - 明确 metadata active binding 只能经 market wrapper 修改。
   - 明确 content access stale row 可 permissionless cleanup。
5. 跑验收命令。
   - `sui move test --path move/soulidity`
   - targeted new-web tests
   - `npm run typecheck`
   - `npm run build:web:production-env`
