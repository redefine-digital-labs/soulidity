# Vercel Prisma Runtime Resolution Fix Spec

## Goal

修复 PR #10 的 Vercel Preview 构建失败，让干净安装环境下的裸 `next build` 也能解析 Prisma runtime，不再依赖当前机器根目录里偶然存在的 extraneous `@prisma/client`。

## Scope

- `prisma/schema.prisma`
- `web/**` 中所有直接引用 Prisma generated client 的运行时代码
- `src/db/**`
- `scripts/**`
- `tests/**`
- `docs/specs/2026-04-14-vercel-prisma-runtime-resolution-fix/PLAN.md`

## Non-Goals

- 不处理当前仓库里与 Prisma 无关的类型错误、告警或依赖告警
- 不调整 Vercel Dashboard 配置；优先通过仓库改动让默认构建链路可工作

## Constraints

- 变更必须保持 Prisma schema 仍然由根目录 `prisma/schema.prisma` 驱动
- 新路径确认替代旧路径后，同轮清理旧 import 与误导性文档描述
- 验证必须覆盖当前工作区构建，以及接近 Vercel 的干净安装复现

## Acceptance

1. Prisma client 生成目录迁到 `web/generated/prisma`，不再依赖仓库根 `generated/prisma`。
2. 仓库内所有运行时代码、脚本、测试对 Prisma generated client 的引用均更新到新路径。
3. `npm --prefix web run build` 通过。
4. 在干净 worktree 中按 Vercel 类似安装顺序执行 `cd web && npm install && cd .. && npm install && cd web && npx prisma generate --schema=../prisma/schema.prisma && npx next build` 通过。
