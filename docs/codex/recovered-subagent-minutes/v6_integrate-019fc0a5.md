# Meeting minutes: `v6_integrate`

## 任务与范围

收敛本地 v6 Move、迁移脚本、配置和查询链路；修复迁移对象验证与主网 mutation journal 的 P1；只读整理 Production 环境同步和部署顺序。任务内未提交、未推送、未部署或写链。

## 最终结论

- v6 集成代码在本地完成，Move 与定向回归通过，gate 保持关闭。
- `MarketAdminCapV2` 嵌套进 `MarketAdminCapV6` 后不能按顶层对象读取，验证须读取 V6 cap 内嵌字段和事件。
- 签名 journal 应位于仓库根私有目录 `.soulidity-state/`，目录 `0700`、文件 `0600`，原子写入并 fsync。
- journal 缺失必须 fail closed；只可用一次性明确确认初始化，不能与执行/恢复混用，且检查必须早于 key 加载、构建和签名。

## 关键决策

- 签名字节和 journal 不得放在 SDK、Web 或其他可部署源码目录。
- 重复初始化、缺失 journal 或未核销交易均拒绝继续。
- Vercel 安全顺序：确认项目 → dry-run → 显式写入关闭态 gate → apply → 回拉校验 → 链上只读 postflight → Production deploy。
- Production 环境同步失败不得继续；Production deploy 会先执行 Prisma migration，属于独立生产数据库写入。

## 历史改动与证据路径

- `.gitignore`、`.vercelignore`
- `move/soulidity/sources/market.move`
- `scripts/lib/soulidity-mainnet-migration.ts`
- `scripts/upgrade-soulidity-mainnet.ts`
- `scripts/retire-soulidity-legacy-market.ts`
- `scripts/sync-vercel-production-env.ts`
- `packages/soulidity-sdk/src/deployment-manifest.json`
- `tests/scripts/mainnet-mutation-journal-hygiene.test.ts`
- `tests/scripts/soulidity-mainnet-migration.test.ts`
- `tests/backend/production-env-sync.test.ts`

后续 Git：`bee4a94` / merge `29c2de5`；链上记录 `e18a942` / merge `1ae48c3`。

## 验证结果

- 集成：Move 137/137；6 个定向文件 139/139；`git diff --check` 通过。
- 嵌套 Cap 修复 24/24；journal 隔离 47/47；fail-closed 50/50；fresh-publish/postflight 62/62。
- 对应 TypeScript 和 diff-check 通过。
- 最终 Vercel 检查为只读，没有部署或外部写入。

## 风险、未完成项与后续变化

- 当时根类型检查仍有既有 TS7022；worktree 未链接 Vercel 项目；环境同步脚本不会用空值删除远端旧 optional 值。
- Vercel 只覆盖两个 Animacraft gate；V2/V6 secondary 必须由链上 postflight 验证。
- 恢复时先确认 `.soulidity-state` 排除与权限测试，明确初始化 journal，再进行 dry-run/执行；Production DB 变更须另行授权。

## 来源追踪

- Thread ID：`019fc0a5-a248-7001-bb5a-2348bc1d3a2a`
- 原始 source：2,459,715,174 B；SHA-256 `dacd9fcc73fcfb28f62b02839730aca123a1111d202911f47b34ad029ab14170`
- 压缩正文：1,647,251,585 B；SHA-256 `5081578c73b0a37ef7e621fef4a6c8a5b468ad564ef26f3f8210a2d9eaca6902`
- 脱敏导出：1,162 条消息；SHA-256 `f8d10f1154ad66f22545eb0e2f3a2344f9ee7629c3e2613c540d2255666034eb`
- 代表性消息：
  - `b12a6c87e6db23ea34d4555c66a781e680c21f78e1989d96b619a7be744388d2` — `2026-08-02T05:46:03.314Z`
  - `e5bdddb9a8fc136697ff1dc21f7c13161a97675502911db547f507df7e11b70a` — `2026-08-02T05:48:37.538Z`
  - `b03fbc306026197fcbe245bb892eb8731554e45cf76ba185d76afc4090dd1a44` — `2026-08-02T05:55:10.730Z`
  - `62e16e70fba3d832f31578e2b50d23311b0b154e9c8a2ae1e05e76ffb6f8fd84` — `2026-08-02T06:04:34.254Z`
  - `8ac2be52dfa261fd5d2f224329361aff0e719a8845da62d6e0f8136687060933` — `2026-08-02T06:48:22.952Z`
