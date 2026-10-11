# Meeting minutes: `pack_publication_reuse`

## 任务与范围

收口 v7 衣柜/Pack 继承发布结果，并实现不依赖 UI 的 Expansion Pack v8 纯发布恢复状态机；不执行主网写入。

## 最终结论

- 历史 Animacraft PR #52 与 Soulidity PR #30 的 CI、生产构建和 Vercel Preview 均报告通过；当时 Animacraft 913 项、Soulidity 1,371 项应用测试和 137 项 Move 测试通过。
- Pack 只增量维护自己的 Part/Item/Style、价格和发布信息，母 Maker 的画布、Renderer、Layer、基础素材、Rules、Smart Color、Recipe、Soul、衣柜、商业前提与版权只读继承。
- v8 发布恢复顺序锁定为父 Maker readback、Walrus prepare/register/upload/certify、create Pack、register Styles、seal、可选 Seal binding、admit、activate。

## 恢复状态机与验证

- 每一步区分 intent、submission 和精确对象/事件 readback；失败后保留原提交做只读恢复。
- 新状态机测试 5/5；Pack candidate、Walrus、认证可见性和草稿 CAS 联合回归 31/31。
- 当时尚未接入实际 Blob 解析/重新哈希、IndexedDB checkpoint、Transaction builder 和对象/事件 reader。

## 风险与恢复入口

- 预览和 PR 通过不等于主网 gate 已开启；没有主网交易。
- 恢复时核对当前发布适配器是否补齐四项未接线能力，并参考[脱敏恢复摘要](../recovered-subagent-summaries/pack_publication_reuse-019fe89d.md)。

## 来源追踪

- Thread：`019fe89d-da3e-7471-a311-fcf5f69aa1d4`；Parent：`019f5069-93af-7eb1-9308-6f7b7ddcaab0`
- 原始大小：3,274,682,854 B；尾部检查 49.7 MiB；恢复消息 8；终态信号 `unknown`
- 代表消息 SHA-256：`fe35f3d728d98c2ac1173aca817805c99f7a6e677ecf2939530bb26e4c80279a`
