# New-Web Frontend Style Fix Spec

## Goal

以 `docs/specs/prototype.html` 为视觉基线，修复 `new-web` 当前前端样式分散、页面密度失衡、导航与基础组件不统一的问题，并补上缺失的响应式适配，让首页、导航和主要列表/创建入口页在同一套设计语言下工作。

## Scope

- `new-web/app/globals.css`
- `new-web/app/layout.tsx`
- `new-web/app/page.tsx`
- `new-web/app/market/page.tsx`
- `new-web/app/community/page.tsx`
- `new-web/app/create/page.tsx`
- `new-web/app/create/content/page.tsx`
- `new-web/app/import/page.tsx`
- `new-web/app/import/upload/page.tsx`
- `new-web/app/wrap-link/personal/page.tsx`
- `new-web/components/layout/app-shell.tsx`
- `new-web/components/layout/page-container.tsx`
- `new-web/components/layout/section-header.tsx`
- `new-web/components/nav/navbar.tsx`
- `new-web/components/nav/nav-create-menu.tsx`
- `new-web/components/nav/nav-resources-menu.tsx`
- `new-web/components/nav/account-button.tsx`
- `new-web/components/nav/filter-tabs.tsx`
- `new-web/components/nav/flow-bar.tsx`
- `new-web/components/ui/button.tsx`
- `new-web/components/ui/card.tsx`
- `new-web/components/ui/input.tsx`
- `new-web/components/ui/tag.tsx`

## Requirements

1. 全局视觉 token 必须与 prototype 的深色基底、紫/青/金强调色、卡片层级和玻璃感导航保持一致。
2. 顶部导航必须恢复 prototype 的信息层级：
   - logo、主导航、Create 按钮、Resources、账户/登录入口之间的主次明确；
   - 移动端菜单样式与桌面端语言一致。
3. 基础组件必须统一：
   - button、card、input、tag、filter tabs、flow bar、section header、page container 不再各自为政；
   - hover / focus / active 态要延续同一套交互反馈。
4. 响应式布局必须补齐：
   - 手机宽度下不得出现 CTA 区、数据统计区、筛选控制区、步骤按钮区和侧栏布局挤压或阅读顺序反直觉的问题；
   - 共享组件优先采用 mobile-first 布局，在 `sm`/`lg` 以上逐步展开，而不是桌面稿直接下压到窄屏。
5. 首页必须对齐 prototype 的 landing hero 结构与节奏，修复 CTA、数据指标和功能卡片在桌面与移动端的尺寸/间距失衡。
6. `market` 与 `community` 页必须修复“过密、过碎、层级弱”的问题，提升容器、卡片、标签、操作按钮和侧栏的一致性。
7. `create`、`create/content`、`import`、`import/upload`、`wrap-link/personal` 这些创建入口页必须与统一组件对齐，避免继续保留另一套旧样式。

## Non-Goals

- 不在本轮重写业务逻辑、数据获取或鉴权流程。
- 不为所有长尾页面做逐页视觉重构。
- 不修改 `prototype.html` 本身。

## Acceptance

- 本地运行后，首页、`/market`、`/community` 与创建入口页视觉上与 prototype 同属一套设计系统，不再出现明显的按钮尺寸、卡片密度、标题层级和导航风格割裂。
- 全局导航在桌面与移动端都保持统一的边框、背景、按钮和下拉菜单风格。
- `390px` 左右移动端宽度下，导航抽屉、首页 CTA/数据区、市场页筛选控制区、创建流程底部操作区都能自然换行或堆叠，不出现水平挤压与关键操作越界。
- 基础组件被目标页面复用，相关页面内联重复样式明显减少。
- `npm run lint` 通过。
- `npm run build` 通过。
