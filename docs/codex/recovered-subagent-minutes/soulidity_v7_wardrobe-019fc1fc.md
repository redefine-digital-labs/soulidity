# Meeting minutes: `soulidity_v7_wardrobe`

## 任务与范围

在不破坏 v6 的前提下把 Physical Wardrobe v7 接入 Soulidity：配置化 ABI、链上绑定查询、可信 Renderer、SDK 原子交易、衣柜 UI、Complete OC 初始装备和市场入口保护。ABI 收口前不更新依赖 pin、不提交、不部署、不写主网。

## 最终结论

- 线程以 `turn_aborted` 结束，不能视为完整交付。
- 可确认的代理自述结果是 Renderer 篡改校验与前端类型检查通过，以及 v5 Complete Recipe → v7 初始装备的 staged authorization 已收口；工具日志和完整回归未保留。
- 发布开关、依赖 pin 和部署保持不动；最后仍在计划 v7 专用 listing/cancel/purchase，因此市场闭环未完成。

## 关键决策

- Wardrobe 是 v7 初始外观真相源；Complete 必须绑定 canonical MakerRoot、sealed v6/v7 Profile 和 Soul Wardrobe。
- 交易身份只信 SoulState 的 v7 链上绑定；画面还必须核对 Profile、ItemProduct、Walrus companion、manifest、PNG 尺寸和 hash，不能信 Display 元数据。
- 初始 Recipe 按原始顺序构造：视觉行绑定 Family/StyleProduct，None/Color 行只验证 style key，最终由 Commerce v5 hash 核验。
- v7 Soul 不是永久不可交易；只在外部可取回 Style 未全部撤出时禁止上架。
- v7 需要专用 listing/cancel/purchase，旧 v5/v6 路径必须拒绝 v7。

## 历史改动与证据路径

线程自身没有可恢复的精确 diff。后续 Git `43dfff0` / `eacfde1` 落盘 Physical Wardrobe v7；`832616a`、`40abb29`、`754e7d3` 又继续市场、包大小与管理功能。这些是后续证据，不改变线程中断时的未完成状态。

主要恢复路径：

- `move/soulidity/sources/animacraft_wardrobe_adapter_v7.move`
- `move/soulidity/sources/market.move`
- `move/soulidity/sources/soul.move`
- `packages/soulidity-sdk/src/physical-renderer-v7.ts`
- `packages/soulidity-sdk/src/physical-wardrobe-v7.ts`
- `packages/soulidity-sdk/src/tx/physical-wardrobe-v7.ts`
- `web/components/souls/physical-wardrobe-v7.tsx`
- `web/lib/animacraft/handoff.ts`
- `tests/new-web/physical-wardrobe-v7.test.ts`
- [旧恢复摘要](../recovered-subagent-summaries/soulidity_v7_wardrobe-019fc1fc.md)

## 验证结果

- Renderer 篡改校验、前端类型检查：代理报告通过，无命令和日志。
- staged authorization：代理报告收口，无最终全量回归。
- gift SDK、完整类型检查、v7 专用市场路径：中断时仍为待办。
- Move/SDK/Web 全量测试、commit、PR、部署和主网写入：本线程无完成证据。

## 风险、未完成项与后续变化

- 初始授权之后仍计划统一 Handoff 行映射、SDK builder 和测试，不能把“收口”理解成整个功能完成。
- 旧市场若未拒绝 v7，可能绕过外部资产撤出要求；Renderer 若退化到 Display 元数据，会重新引入素材伪造。
- 后续提交已继续演进；恢复时必须以当前源码和测试为准，而不是复用旧线程状态。

## 恢复入口

1. 从 `43dfff0` / `eacfde1` 和 `754e7d3` 对账当前 ABI 与衣柜管理实现。
2. 复核 MakerRoot、v6/v7 Profile、SoulState 动态字段、Recipe 行序和 staged authorization。
3. 验证 gift、专用 listing/cancel/purchase、旧路径拒绝、Renderer 篡改和完整 Move/SDK/Web 构建；闭环前保持 gate 关闭。

## 来源追踪

- Thread ID：`019fc1fc-f63a-7a50-9654-741735631d87`
- Parent Thread ID：`019f5069-93af-7eb1-9308-6f7b7ddcaab0`
- 原始 source：2,766,793,167 B；SHA-256 `a9f79a593ac15bf6619a4af8590dd914dcec02501dc8e539c626c35eca8435f3`
- 压缩正文：1,857,627,252 B；SHA-256 `6f9311fb6ffa330ee0d7a0a27d87de40a02a7cb26fcde678d68c97f6af8c28b0`
- 脱敏导出：959,843 B，1,239 条消息；SHA-256 `bbe5edc05c1e3c0d88f33a08d14e91d50d4bf7c69fe8c08991c6859c0d3f26ab`
- 提取统计：解析 28,668 条记录，0 条无效，排除 117 条超大记录；脱敏文本 715,558 B。
- 提取验证：manifest sidecar、archive/source SHA-256 和大小通过，前后均未检测到打开句柄。
- 代表性消息：
  - `2095f77ed538eb670d63ff7aeb82983c50c6d093ac8f46af2a0b99868def0b5a` — `2026-08-02T11:23:33.298Z`
  - `de5e9e14ef5c37971a6184726d479a38b613f744c1edb8fd0aed9b55e10ea8d8` — `2026-08-02T11:51:35.114Z`
  - `9eae7f57b5b826efd70c2d485df15abeca919b8b51ba3d659fead890f213d634` — `2026-08-02T12:18:23.758Z`
  - `1a05374967ef241e3f20cbd052e5fc79b3ebdd64049831504d783268e42fc69c` — `2026-08-02T12:44:08.535Z`
  - `a5b12848c3d9d358d2f943b7bcabcc1cf53cc67f05a0c4bc1be3ed93ba502797` — `2026-08-02T13:09:44.071Z`
