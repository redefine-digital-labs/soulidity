# My Souls Visual Parity Spec

## Goal

让 `app/my-souls/page.tsx` 的桌面与移动端实现尽量贴近参考图的视觉结构，同时保留当前页面的数据来源、tab 语义、链接目标和空态逻辑，不引入新的接口契约。

## Scope

- `app/my-souls/page.tsx`
- `SPEC.md`
- `PLAN.md`

## Constraints

- 只做最小充分改动，不改动 `app/api/souls/my/route.ts` 的当前契约
- 视觉对齐优先级高于复用旧样式，但不能破坏现有 tab 切换和跳转
- 必须兼顾桌面与移动端，避免操作区横向溢出

## Acceptance

1. 页面头部与参考图一致为 `Dashboard / My Souls / subtitle` 结构，并保留右侧 `Edit Public Profile` 与 `Create Soul` CTA。
2. tabs 改为圆角 pill 风格，`Owned` / `Listings` 显示计数，切换逻辑保持不变。
3. `Owned` / `Listings` 使用双层 Soul 卡片视觉：紫色主卡面、深色底部信息条、方形 avatar、紧凑状态 badge、授权/出售按钮排布贴近参考图。
4. provenance 与 grant 状态文案继续来自现有数据，不增加新接口字段。
5. `Collections` / `Activity`、登录态、加载态、空态仍可用且不回退。
