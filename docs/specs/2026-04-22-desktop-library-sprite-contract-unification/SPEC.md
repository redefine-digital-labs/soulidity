# Desktop Library Sprite Contract Unification

## Goal

统一 desktop library 的 soul sprite contract：

- canonical metadata key 固定为 `persona.moodMap`
- canonical sprite asset name 固定为 `persona-sprite`
- `My Souls` 显示全部 owned soul，但仅在 metadata 明确存在合法 sprite 时允许下载
- `Browse Marketplace` 只展示 listed soul，listed 不再自动放开下载权限
- desktop downloader / cache / UI / route / producer 统一切到 metadata 驱动

## Scope

- web metadata normalization 与 desktop sprite manifest
- `/api/desktop/catalog` 与 `/api/desktop/catalog/[id]`
- desktop cache/downloader/IPC/renderer library UI
- asset access shared helper
- publish/import/extract 的 canonical producer plumbing
- targeted tests

## Non-Goals

- 不新增 Prisma schema migration
- 不伪造不存在的 sprite metadata
- 不改已有 starter persona 文件结构

## Acceptance

1. soul metadata 读取时接受 legacy `stateMap`，但统一归一化为 `moodMap`
2. soul sprite asset 只认 `persona-sprite`
3. desktop catalog item / manifest 暴露 `listingStatus`、`listedPriceAtomic`、`spriteDownloadPolicy`
4. marketplace 下载权限严格由 metadata 决定：
   - `public` 可下载
   - `owner-only` 仅 owner 路径可下载
   - `missing` / `invalid` 禁用并提示
5. `/api/desktop/catalog/[id]` 不再因为 listed 自动公开 sprite
6. desktop cache canonical 文件名统一为 `persona-sprite.png` / `persona-sprite-config.json`，但保留 legacy 读兼容
7. 单个 soul 的下载 progress / error 只影响对应卡片
8. tx builder / producer plumbing 不再把新 asset 默认命名为 `default`；有初始 sprite asset 时默认写 canonical `persona-sprite`
