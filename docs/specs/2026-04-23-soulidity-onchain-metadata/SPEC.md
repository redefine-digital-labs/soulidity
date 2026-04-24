# Soulidity On-Chain Metadata Object

## Goal

把 Soulidity 的 persona / voice metadata 从 `Soul.metadata_ref` 外部 JSON 硬切到链上 `SoulMetadata` 共享对象，统一链上真值、mirror projection、web publish/import/wrap builder、desktop catalog / bundle 读取逻辑，并清理旧 `metadata_ref` / 外部 metadata fetch / metadata blob upload 双轨残留。

## Scope

- `move/soulidity`：新增 `metadata.move`，`Soul` / `SoulState` / `market` / `assets` / `protocol_tests`
- `prisma` + `web/lib/soulidity` projection、query、event、mirror、repository、tx builder、metadata parser
- `web/app/api/souls/[id]/metadata` 与 publish / import / personal-join sync 路由
- `web/lib/desktop`、desktop catalog / persona bundle / downloader、相关测试
- 必要的 contract / SDK / desktop companion 文档

## Non-Goals

- 不做 binding-level ACL；`allowlist` 继续复用 Soul 级 `ContentAccessList`
- 不引入 `object_table`
- 不保留 `metadata_ref` 兼容写入或外部 metadata JSON fallback
- 不改 assets / seal / grant / content-access 的核心权限模型，只重定 metadata 真值来源

## Contract Decisions

1. `Soul.metadata_ref` 删除；`SoulState` 新增 `metadata_id: Option<ID>`
2. 新增共享对象 `SoulMetadata { id, soul_id, active_sprite, active_voice, ext }`
3. `AssetBinding` 固定字段：`asset_name`、`version_index`、`download_policy`
4. `download_policy` 固定枚举：`public`、`owner_only`、`allowlist`
5. 权限真值和 active selector 只存在 typed 字段；`ext` 只放 UTF-8 JSON bytes blob
6. 资产版本的可删性受 active binding 保护；正在被 `active_sprite` / `active_voice` 引用的版本链上拒删

## Acceptance

1. mint / import / personal-join 始终创建 `SoulMetadata` 并把 `metadata_id` 绑定到 `SoulState`
2. owner 可链上设置 / 清空 active sprite、active voice，并 upsert / delete metadata blob
3. 非 owner、非法 asset 绑定、visibility 与 `download_policy` 不匹配、删除正在被 active binding 引用的 asset 版本，都会被链上拒绝
4. mirror projection 不再暴露 `metadataRef`，改为 `metadataOnChainId`、active binding 字段、`spriteConfigJson` / `spriteMoodMapJson` / `voiceConfigJson`
5. publish / import / wrap 不再上传 metadata JSON blob；本地只校验 sprite config，然后把 initial binding + config JSON 直接编码进 PTB
6. `/api/souls/[id]/metadata` 继续保留路径，但语义改成 metadata object mutation sync
7. desktop catalog / persona bundle / sprite access 全部改读 mirrored on-chain metadata，并按 `public` / `owner_only` / `allowlist` 解释下载策略
8. 文档与测试不再把 `metadata_ref` 当主合同；Move / Vitest / desktop 相关回归通过
