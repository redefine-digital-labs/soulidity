# Web Persona Sprite Upload Closure

**Status (2026-04-23)**: Superseded by `docs/specs/2026-04-23-soulidity-onchain-metadata/`. This spec describes the pre-hard-cut mint-time `metadataRef` rail. Current runtime truth is the on-chain `SoulMetadata` object plus active asset bindings; do not use this file as the current contract reference.

## Goal

把 web 端所有 Soul 入口补齐到同一个 canonical `persona-sprite` contract：

- create / import / personal join / collection batch 都能在 mint 时一起上传 persona sprite sheet + metadata
- 不再保留“web 端还没接 sprite metadata”的入口缺口

## Scope

- sprite config 解析与 canonical metadata 生成
- mint/import/join/collection 的 UI / provider / upload / sync plumbing
- batch 入口的文件配对与 config 前置校验
- targeted tests

## Non-Goals

- 不新增 Prisma migration
- 不改 desktop starter persona 文件结构
- 不尝试为已发行但缺少 `assetsOnChainId` 的 Soul 伪造后补 root
- 不做 post-mint persona sprite 管理面。当前协议里 `metadataRef` 只在 mint/import/join 时写入，没有可验证的 web 侧 metadata 更新链路；继续暴露 append/delete 只会留下半套能力

## Acceptance

1. web 单 Soul create/import/personal-join 都支持可选上传：
   - sprite sheet
   - sprite config JSON
   - visibility 选择 `private` / `public`
2. collection folder 批量上传支持每个子目录可选提供：
   - `persona-sprite.png|jpg|jpeg|webp|gif`
   - `persona-sprite-config.json` 或 `sprite-config.json`
   并在 mint 时写入 canonical metadata + initial asset
3. metadata 统一生成 `version: 1` + `persona.format = "sprite-sheet"`，asset name 固定为 `persona-sprite`
4. private sprite 会把 `assetsSealSidecar` 从前端一路带到 publish/import/personal-join/collection mirror
5. 所有入口都前置校验 sprite 文件配对关系与 config JSON 结构，不把明显错误拖到签名后
6. targeted tests 覆盖：
   - sprite config -> metadata
   - asset tx builder
   - mint flow plumbing
