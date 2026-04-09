# Soul Content Storage Hard-Cut Spec

## Goal

按 `/Users/admin/.claude/plans/harmonic-puzzling-puzzle.md` 一次性把 `move/soulidity + new-web + prisma` 的 Soul 内容存储链路切到新架构：Memory 改为 `Table<u64, ID>`、Skills 改为 `Table<String, vector<SkillSlot>>`，Soul/Memory/Skills 全部具备 Seal sidecar 和 access API，默认走加密上传，并同步清理旧 `MemoryEntry` / `SkillVersion` / `latestSkillVersionOnChainId` / 旧路由形状等兼容尾巴。

## Scope

- `move/soulidity/**`
- `prisma/schema.prisma`
- `prisma/migrations/**`
- `new-web/lib/soulidity/**`
- `new-web/lib/hooks/**`
- `new-web/app/api/souls/**`
- `new-web/app/api/agent/souls/**`
- `new-web/app/create/**`
- `new-web/app/import/**`
- `new-web/app/wrap-link/**`
- `new-web/app/resources/**`
- `new-web/app/souls/[id]/page.tsx`
- `new-web/components/souls/**`
- `docs/specs/soul-content-format.md`
- `tests/new-web/**`

## Non-Goals

- 不兼容旧链上 `move/soulidity` 数据，不做迁移
- 不保留旧 object ID、旧 route 参数形状、旧 projection 唯一键
- 不处理 `timestamp_ms` 同毫秒碰撞
- 不扩展新权限模型；继续以 owner / granted-agent / public 为边界

## Constraints

- 以 fresh deploy 为前提，开发环境允许直接重建 package/shared object/DB schema
- 新方案确认替代旧方案后，旧字段、旧路由、旧查询逻辑、旧 UI 文案、旧测试断言必须同轮清理
- Memory 默认 encrypted upload，不再保留 public blob 作为默认产品路径
- Skills 上传入口限制 `.zip`，`skillName` 以 ZIP 内 `SKILL.md` frontmatter `name` 为准
- `new-web` 细节页、skills panel、access API 不能再依赖 `entryIndex` / `versionOnChainId` / `latestSkillVersionOnChainId`
- 所有完成声明前必须有新鲜验证证据

## Acceptance

1. `move/soulidity` 完成新对象模型：`SoulState.memory_id`、`SoulMemory.entries: Table<u64, ID>`、`SoulSkills.skills: Table<String, vector<SkillSlot>>`，并移除 `MemoryEntry` / `SkillVersion` 链路依赖。
2. `move/soulidity` event 与 approval 契约切到新复合键：memory 使用 `timestamp_key`，skills 使用 `skill_name + version_index`。
3. Prisma schema 与 projection 改成 `(memoryOnChainId, timestampKey)` 和 `(skillsOnChainId, skillName, versionIndex)` 唯一键，不再保留 `latestSkillVersionOnChainId`、`entryIndex`、`versionOnChainId`、`previousVersionOnChainId`。
4. `new-web/lib/soulidity` 的 types / queries / events / repository / mirror / access / tx builder 全部收口到新契约。
5. create / import / personal-join / memory append 默认走 encrypted upload，并能构建 founding/append memory sidecar。
6. human / agent memory access route 按 `/memory/[entryKey]/access` 工作；human / agent skills access/delete route 按 `/skills/[skillName]/versions/[versionIndex]/*` 工作。
7. skills append/list/delete/open 支持多 skill，默认 private；显式 public 路径仍可工作。
8. create/import/wrap-link 页面、Soul detail 页和 skills panel 使用新模板、新字段和新资源页入口，不再暴露旧格式或旧 key。
9. `docs/specs/soul-content-format.md` 更新为新方案已实现规范。
10. 验证至少覆盖：
   - `sui move test --path move/soulidity`
   - `npm test -- tests/new-web/**` 或等价覆盖 relevant new-web suite
   - `npm --prefix new-web run typecheck`
   - `npm --prefix new-web run build`
