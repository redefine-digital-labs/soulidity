# 既有原型工具与本轮设计交接

原型主要工具是Penpot；早期Figma作过视觉比较，后续因当时工具额度限制迁到Penpot。此结论来自实际本地收据与交接，不是推测当前套餐限制。

## 已有资料

- 项目交接：`docs/codex/handoffs/20261005-penpot-design-migration.md`。
- 本地设计目录：`/Users/naoer/Documents/Codex/2026-10-05/soulidity-prototype-assessment/`。
- 可编辑基线：`outputs/animacraft-soulidity-design.penpot`。
- 导入/工具收据：`outputs/prototype/penpot-receipt.json`和`figma-receipt.json`。
- 原生构造流程：`work/penpot/build-native.py`；原型HTML、优化稿及基线对照亦保留。
- [已有Penpot云文件](https://design.penpot.app/#/workspace?team-id=7eed092c-bad6-802e-8008-be6332a485e5&file-id=7eed092c-bad6-802e-8008-be663a5caa00&page-id=59a27626-3e2c-4f71-86d5-6f492f96b105)。

既有收据记36屏+封面、3343文本/9089矩形、部分编辑/导航已验证。团队协作迁移、命名基线与最终导出未完成；旧迁移因并发Chrome使用暂停/阻断。本轮不操作该Chrome/钱包，也不把旧工作改成完成。

## 当前施工依据与历史文件处置

用户2026-10-07明确纠正：施工依据只取现在的网站真实前端，保留页面结构和操作路径，替换底层合约并理顺必要UIUX细节。逐页记录见[现前端核对](02_UIUX_CN.md)。Penpot仅解释过去使用过哪个工具；历史37画板不能凌驾现网站。

本轮另做的 `output/soul-dof-v1-preparation/uiux/index.html`、六视图截图和 `soul-dof-v1-review-candidate.penpot`（44画板）均标记为 **Superseded / 不作为施工或验收依据**。原37画板和新文件保留作为历史记录，不删除、不继续云导入/编辑，不将云原型验证设成当前开工门禁。

此前上传的v1/v2 ZIP含这些偏离范围的交互草稿，属于历史包，不能作为最新施工材料。最新依据是当前Slack Canvas及本地准备文件。既有Penpot迁移状态不变，原生产会话不操作。

## 下一步

继续审阅现前端逐页接口与最小差异，明确未实站执行的权限/交易场景。只有用户明确确认开工后，才在现有页面/组件内接入新合约与SDK；不得恢复独立新交互原型作为主线。
