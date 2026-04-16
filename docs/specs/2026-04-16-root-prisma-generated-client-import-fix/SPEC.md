# Prisma Client Boundary Unification Spec

## Goal

一次性收口仓库里的 Prisma generated client 入口，消除 root / web / scripts / tests 各自直接引用 `generated/prisma` 或 `web/generated/prisma` 的路径分叉，避免同类 runtime import 问题反复出现。

## Scope

- `prisma/schema.prisma`
- `generated/prisma/**`
- `src/db/database.ts`
- `src/db/prisma-client.ts`
- 根目录直接运行的 Prisma 相关脚本
- `web/lib/prisma.ts`
- web 内依赖 `Prisma` 类型的服务端代码
- 相关测试与文档
- `docs/specs/2026-04-16-root-prisma-generated-client-import-fix/PLAN.md`

## Non-Goals

- 不调整数据库 schema 语义或任何数据表结构
- 不更换 Prisma generator 类型
- 不处理与 Prisma client 边界无关的其他构建问题

## Constraints

- Prisma generated client 只能保留一个 canonical 输出目录
- 业务代码不得再直接 import `generated/prisma/**` 或 `web/generated/prisma/**`
- root / web / scripts / tests 必须统一通过同一个仓库内 shim 边界访问 Prisma runtime 与类型
- 同轮清理双输出和旧路径残留
- 验证必须覆盖 root `tsx` 运行时场景，以及源码层“无直连 generated 路径残留”的约束

## Acceptance

1. `prisma/schema.prisma` 只生成一份 Prisma client。
2. `src/db/prisma-client.ts` 成为唯一 Prisma client shim，统一导出 `PrismaClient` 与 `Prisma`。
3. root / web / scripts / tests 不再直接引用 `generated/prisma/**` 或 `web/generated/prisma/**`，只经过统一 shim。
4. 根目录 `src/db/database.ts` 可被 `node --import tsx` 成功导入。
5. `npm run dev` 不再因 Prisma client 路径或导出不一致在启动阶段崩溃。
6. 新增自动化测试能同时卡住 runtime import 回归和“禁止直连 generated 路径”的源码约束。
