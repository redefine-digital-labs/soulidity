# Vercel Prisma Runtime Resolution Fix Plan

1. 先锁定修复目标。
   - 以 Vercel 失败日志和干净 worktree 复现作为 root cause 证据。
   - 以 Acceptance 3/4 作为本轮验收基线。
2. 再收口 Prisma 输出与引用路径。
   - 把 `prisma/schema.prisma` 的 generated client 输出迁到 `web/generated/prisma`。
   - 更新 `web`、`src/db`、`scripts`、`tests` 中所有旧 `generated/prisma` import。
   - 更新对外文档中的 generated client 路径说明。
3. 最后验证并清理旧残留。
   - 重新生成 Prisma client。
   - 运行 `npm --prefix web run build`。
   - 在干净 worktree 复跑 Vercel 类似安装 + 裸 `next build`。
   - 删除旧 `generated/prisma` 目录残留，确保搜索结果只剩新路径或历史文档。
