# Prisma Client Boundary Unification Plan

1. 先锁定回归。
   - 新增失败测试，约束 Prisma shim 必须统一导出 `PrismaClient` / `Prisma`。
   - 新增失败测试，约束业务代码不得再直连 `generated/prisma` 路径。
   - 保留 `node --import tsx --eval "await import('./src/db/database.ts')"` 作为 root runtime 验收基线。
2. 再收口 Prisma client 边界。
   - 把 schema 的双输出收敛成单输出。
   - 让 `src/db/prisma-client.ts` 指向唯一 generated client，并统一暴露 runtime 与类型。
   - 更新 root / web / scripts / tests 到统一 shim。
   - 删除废弃的 `web/generated/prisma` 残留与相关文档误导。
3. 最后按 Spec 验收。
   - 跑新增测试与定向 typecheck。
   - 复跑 root runtime import 与必要搜索验证，确认没有直连 generated 路径残留。
