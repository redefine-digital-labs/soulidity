# New-Web Create Basic Info Alignment Spec

## Goal

把 `new-web/app/create/page.tsx` 的 Step 1 整页实现对齐到用户提供的参考图，而不是只修局部控件。页面需要收敛为截图中的信息架构、文案层级和交互：`Soul Name`、`Description`、`Category`、`Tags`、`Preview Image`、`Creator Royalty`、锁定提示，以及底部 `Cancel / Next: Living Content` 操作区。

## Scope

- `new-web/app/create/page.tsx`
- `new-web/components/ui/upload-zone.tsx`
- `tests/new-web/create-basic-info-ui.test.ts`
- `docs/specs/2026-04-04-new-web-create-basic-info-fix-spec.md`
- `docs/plans/2026-04-04-new-web-create-basic-info-fix-plan.md`

## Constraints

- 必须继续复用现有 `UploadZone` 做真实文件选择，不允许回退成只有样子、没有文件输入联动的伪上传区。
- 本轮只做 Step 1 的本地表单结构、样式和轻交互对齐，不扩展后端上传、跨步骤持久化或真正 mint 链路。
- 当前与截图冲突的 `Starting Price`、`List immediately`、5 档 royalty 方案要在本页直接清掉，不能继续并存。
- `Creator Royalty` 只保留截图对应的 4 档：`Off / Low / Standard / High`，其中 `Standard` 要有推荐态。
- 页面仍需兼容移动端，按钮和上传区不能只在桌面宽度下成立。

## Acceptance

1. `/create` 顶部不再渲染 `FlowBar`，而是直接进入 `Create Soul` / `Step 1 — Basic Info` 标题区，整体结构与参考图一致。
2. 表单字段收敛为 `Soul Name`、`Description`、`Category`、`Tags (comma-separated)`、`Preview Image`、`Creator Royalty (optional)`；`Starting Price` 和 `List immediately` 不再出现在源码和页面中。
3. `Preview Image` 点击后会触发文件选择；选择图片后页面展示本地预览、文件名和 `Replace` 操作。
4. Royalty 区域只保留 4 档卡片，`Standard` 默认选中并带有推荐徽标，卡片密度、按钮高度和文案不再溢出。
5. 页面包含“Locked at mint”说明与下方锁定提示卡，底部操作区为左侧 `Cancel`、右侧 `Next: Living Content →`。
6. 仓库内为以上结构补充最小源码级回归守卫，锁定字段集合、上传区接线和 royalty 推荐态。
