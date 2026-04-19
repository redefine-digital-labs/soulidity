# Community Follow Canonical ID Cache Fix Spec

## Goal

一次性收口社区个人页在 `handle` 路由下的关注状态缓存分叉问题，确保页头统计、关注按钮和 follow toggle 全部共享同一个 canonical member id，不再出现“按钮状态更新了但粉丝数不刷新”的双轨表现。

## Scope

- `web/app/community/u/[spaceId]/page.tsx`
- `web/lib/hooks/use-social.ts`
- `tests/new-web/follow-status-regression.test.ts`
- `docs/specs/2026-04-19-community-follow-canonical-id-cache-fix/PLAN.md`

## Non-Goals

- 不改动 follow API 的数据库语义或表结构
- 不扩展社区页的其他 UI 行为
- 不重构 `useFollowStatus` / `useToggleFollow` 的公开接口

## Constraints

- 社区页上的 follow 统计与按钮必须基于同一个 canonical member id 建立 query key
- `handle` / UUID 两种路由入口都必须落到同一份 follow 缓存
- 同轮补上自动化回归保护，防止再次把统计和按钮拆成两组 key
- 改动保持最小充分，不引入新的兼容分支

## Acceptance

1. `/community/u/<handle>` 与 `/community/u/<uuid>` 都会让关注统计读取 canonical `profile.id` 对应的 follow query。
2. 关注按钮与页头统计共享同一个 follow query key；toggle 后按钮状态和粉丝数不再分叉。
3. 新增/更新自动化测试能明确卡住“社区页必须使用 canonical member id 读取 follow 状态”的约束。
