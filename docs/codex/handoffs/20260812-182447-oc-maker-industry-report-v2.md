# Soulidity Phase Handoff: oc-maker-industry-report-v2

## Snapshot

- Created: 2026-08-12T18:24:47+08:00
- Phase: oc-maker-industry-report-v2
- Status: complete
- Goal: 将 OC / Character Maker 行业调研重写为以用户问题与当前解决方案为逻辑骨架、同时完整覆盖区域生态与重点产品的中立 Markdown 报告
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (9 status entries)
- Handoff: `docs/codex/handoffs/20260812-182447-oc-maker-industry-report-v2.md`

## Outcome

完成 2.0 版行业报告：建立三圈边界、五类任务、横向能力矩阵，系统梳理中日韩与英语互联网公开样本、重点产品、商业模式、AI/Avatar/远邻接 Web3 边界，并加入检索口径、分类名录与事实复核清单。删除项目策略与公司尽调叙事；修正 NEKA 商用边界和 Story 转向 DATA Network 等高风险事实。

## Scope and non-goals

### In scope

- OC / Character Maker 核心市场、邻接市场与基础设施边界
- 中国、日本、韩国、英语互联网与欧洲可见样本的区域比较
- Picrew、NEKA、特盐、Toyhouse、CharacterHub、UnVale、VGen、YCH、ZEPETO、VRoid、Holoworld、MyShell 等重点产品
- Daydreams、Virtuals、原 Story/现 DATA Network 仅作为远邻接边界

### Intentionally not done

- 不提供 Soulidity/OCL 产品路线或投资建议
- 不做运营主体、融资、团队或公司尽调
- 不声称商店与私域名录为数据库绝对全量

## Durable decisions

- 正文采用用户问题与解决方案、区域生态、重点产品案例三条主线；产品可以多标签，但比较时先对齐核心对象与留存循环。
- 公开安装量、评分、平台注册、活动人数、并发和代币市值不可混作 MAU、GMV 或收入。
- NEKA 现有付费二改授权不含商用；原 Story 已于 2026-06 转向 DATA Network。

## Changed paths and assets

### Changed paths

- docs/research/OC_MAKER_INDUSTRY_LANDSCAPE_CN.md

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- markdownlint PASS
- git diff check PASS
- table pipes single H1 and URL inventory PASS

## Risks and recovery

### Risks or blockers

- 欧洲、东南亚、拉美、印度、中东、非洲及私域/成人社群仍是明确覆盖盲区；附录为公开可索引候选名录，不是商店数据库全导出。

### Recovery or rollback points

- 主交付为 docs/research/OC_MAKER_INDUSTRY_LANDSCAPE_CN.md；未更新 docs/codex/CURRENT.md，未修改发布代码，未 commit/push。

### Working-tree evidence

```text
 M .gitignore
 M CONTEXT.md
 M README.md
?? .pnpm-store/
?? AGENTS.md
?? clawnews/
?? docs/
?? live-portrait.html
?? scripts/
```

## Exact next action

由用户审阅 docs/research/OC_MAKER_INDUSTRY_LANDSCAPE_CN.md，并按目标读者或用途决定是否继续压缩、补充本地语言区域研究或拆出可筛选数据库。
