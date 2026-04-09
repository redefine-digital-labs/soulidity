# New-Web Frontend Style Fix Plan

1. 提炼 prototype 的样式基线与断点策略：
   - 固化深色背景、渐变光晕、边框、卡片层级、按钮和标签语义
   - 统一全局 token、通用页面背景和 mobile-first 断点展开方式
   - PageContainer default max-width 从 1400px 改为 1100px（对齐 prototype），居中（`mx-auto`）
2. 收敛共享骨架：
   - 修正 navbar、create/resources/account 下拉与移动端抽屉
   - 修正 button、card、input、tag、filter tabs、flow bar、section header、page container 的窄屏行为
   - `landing` button variant: 保留 gradient（prototype 有此例外），DESIGN.md 补注"hero CTA 允许 gradient"
   - `.glass-card` 重命名为 `.card` 或移除 class，消除命名误导（实现已经是 flat，但名称暗示 glassmorphism）
3. 修复关键页面：
   - landing 页对齐 hero、CTA、stats、功能卡片，并补齐移动端回落
   - landing "Who is it for" 卡片的 CTA 从内联文本链接升级为 `btn-outline` 按钮样式（提升转化率）
   - landing stats 行移除移动端卡片包裹（全断点统一为裸文本，无 border/bg）
   - market 页修复搜索区、筛选、卡片密度和 collection 区块
   - community 页修复 feed/侧栏布局、发布框、帖子卡片与 sidebar 面板
   - create / create/content / import / import/upload / wrap-link personal 入口页切换到统一组件与节奏，底部操作区采用堆叠式移动端布局
## Information Hierarchy (per page)

### Landing — visual reading order
```
NAV (utility, lowest emphasis)
───────────────────────────────────────────
  EYEBROW   ← teal, tiny, tech credibility
  HEADLINE  ← 1st visual anchor (massive, gradient text)
  SUBTITLE  ← 2nd read (muted, 18px)
  [Primary CTA] [Secondary CTA] ← primary actions
  STATS ROW ← proof layer (bare text, NO card wrapper at any breakpoint)
───────────────────────────────────────────
  HOW IT WORKS  ← education (5-col desktop → 2-col tablet → 1-col mobile)
  WHO IS IT FOR ← audience match (2-col desktop → 1-col mobile)
  TECH STACK    ← credibility footer
```
Mobile collapse: stats 4→2x2 grid, CTAs stack vertically, how-it-works 5→1 column.

### Market — visual reading order
```
SECTION HEADER: label + title + [My Souls] [+ Create Soul]
───────────────────────────────────────────
  [Search input]  [All|DeFi|Art|Infra]   ← filter controls
  [Individual Souls | Collections]       ← view switcher
───────────────────────────────────────────
  ┌─────┐ ┌─────┐ ┌─────┐
  │Card │ │Card │ │Card │  3-col (lg) → 2-col (sm) → 1-col (mobile)
  └─────┘ └─────┘ └─────┘
```
Mobile collapse: search input full-width, filter tabs horizontally scrollable, cards 1-column.

### Community — visual reading order
```
SECTION HEADER + [Publish button]
───────────────────────────────────────────
  FEED (1fr)                 │ SIDEBAR (300px)
  [LIVE|New|Top|Discussed]   │ ⚡ Top Souls (leaderboard)
  [Publish prompt box]       │ 🌐 Communities
  Post 1                     │ 🟢 Live Activity
  Post 2                     │
  [Load more]                │
```
Mobile collapse: sidebar drops BELOW feed (order: header → role cards → filter → publish → posts → sidebar). Sidebar sections stack vertically at full width.

## Interaction States

**Rule: reuse prototype state patterns only. No new state UI is introduced.**
- Empty states → prototype `.empty` pattern (48px icon at 0.4 opacity + 16px label + 13px muted sub + CTA button)
- Error states → prototype `.alert-danger` pattern (10px radius, danger bg/border at 10%/30%, danger text)
- Loading → skeleton with `--card2` bg, pulse animation, same dimensions as content it replaces
- Success → prototype `.success-icon` (72px circle, success green border, checkmark)

| Feature               | Loading              | Empty                          | Error                        | Success     |
|-----------------------|----------------------|--------------------------------|------------------------------|-------------|
| Market soul grid      | 6 skeleton cards     | "No Souls found" + CTA browse  | Alert: "Failed to load"     | Cards render |
| Market search/filter  | Skeleton cards       | "No results for '...'" + clear | —                            | Grid updates |
| Community feed        | 3 skeleton posts     | "No posts yet" + publish CTA   | Alert: "Feed unavailable"   | Posts render |
| Community leaderboard | 5 skeleton rows      | "No karma data"                | —                            | Rows render  |
| Community live feed   | "Connecting..." text | "No recent activity"           | —                            | Items stream |
| Create form submit    | Button spinner       | —                              | Alert: "Creation failed"    | Redirect     |
| Import file upload    | Progress bar         | —                              | Alert: "Upload failed"      | Next step    |
| Wallet connection     | Button spinner       | —                              | Alert: "Connection failed"  | State update |

## Mobile Nav Spec

Prototype is desktop-only. Mobile nav must be specified:
- Breakpoint: `< 768px` (md) triggers hamburger menu
- Behavior: slide-in drawer from right, overlay with backdrop
- Content: all desktop nav links + Create dropdown items + Resources items + Account section
- Animation: `transform: translateX(0)` with `0.2s ease-out`
- Close: tap backdrop, tap X button, or swipe right
- z-index: 150 (above nav at 100, below modals at 200)

## Token Snapshot (per component, from prototype CSS)

| Component | Property | Value |
|-----------|----------|-------|
| **Soul Card** | image height | 140px |
| | body padding | 14px |
| | name | 14px, 700 weight |
| | desc | 12px, muted, line-height 1.5 |
| | price | 13px, 700 weight, gold |
| | hover | border→purple, translateY(-2px), shadow `0 8px 32px rgba(168,85,247,0.15)` |
| **Generic Card** | background | `var(--card)` |
| | border | 1px solid `var(--border)` |
| | radius | 12px |
| | padding | 20px |
| **Button** | radius | 8px |
| | font | 13px, 600 weight |
| | sizes | sm: 5px 12px 12px / default: 8px 18px 13px / lg: 12px 28px 15px |
| **Tag** | padding | 3px 10px |
| | radius | 20px |
| | font | 11px, 600 weight |
| **Nav** | height | 56px |
| | background | `rgba(13,10,30,0.92)` + `backdrop-filter: blur(12px)` |
| | links | 13px, muted → white on hover/active |
| **Filter Tab** | padding | 6px 14px |
| | font | 12px, 600 weight |
| | active | purple bg, purple border, white text |
| **Section Label** | font | 11px, 700 weight, uppercase, letter-spacing 0.1em, purple |
| **Section Title** | font | 24px, 700 weight |
| **Page Container** | max-width | 1100px (default) / 720px (md) / 540px (sm) |
| | padding | 32px vertical, 24px horizontal |
| **Landing Hero CTA** | primary | gradient `135deg purple→purple-deep`, 15px, 700 weight, 14px 32px, 12px radius |
| | secondary | outline, 1.5px border, 15px, 600 weight, 14px 32px, 12px radius |
| **Landing Stats** | value | 28px, 800 weight, -0.02em tracking |
| | label | 12px, muted |

## Resolved Design Decisions

1. **glass-card → card rename**: globals.css 中 `.glass-card` / `.glass-card-hover` 重命名为 `.card` / `.card-hover`（或内联到 Tailwind）。所有引用同步替换。
2. **font-display 空操作清理**: landing h1 的 `font-display` class 移除（`--font-display` 和 `--font-body` 相同，class 无意义）。
3. **2xl:grid-cols-4 移除**: market 和 collections 的 `2xl:grid-cols-4` 移除。max-width 1100px 下永远不会触发 4 列。grid 保持 `1-col (mobile) → 2-col (sm) → 3-col (lg)`。
4. **How-it-works cards**: 改用 `Card` 组件（不含 hover），移除 glass-card 内联用法。
5. **Community role cards**: 移动端保留水平滚动 snap（85vw snap-start），这是有意的触摸体验 — 避免在窄屏堆叠 3 张卡片。桌面端 3 列 grid。

## Accessibility Minimums

- ARIA landmarks: `<nav>` on navbar, `<main>` on page content, `<aside>` on community sidebar
- Keyboard nav: Create dropdown and Resources dropdown must open on Enter/Space, close on Escape, arrow keys move between items
- Filter tabs: arrow-left/right to move between tabs, Enter/Space to activate
- Mobile drawer: focus traps inside when open, Escape closes, return focus to hamburger trigger
- Touch targets: all interactive elements minimum 44x44px tap area on mobile (buttons already meet this with py-2+, but filter tab pills need checking)
- Color contrast: all pairs pass WCAG AA (verified — lowest is purple-on-bg at 4.9:1)

## NOT in Scope

- Space/Profile page redesign — existing prototype patterns, but not in the file scope list
- Soul detail page (`souls/[id]`) — different layout, separate pass
- Light theme tuning — dark is primary, light theme is optional
- Collection detail pages — not in file scope
- Animated page transitions / scroll-linked motion — prototype has no entrance animations
- i18n / RTL support — not this round

## What Already Exists (reuse, don't reinvent)

- `globals.css` tokens already match DESIGN.md (all 12 color variables, spacing, typography)
- `glass-card` CSS class already implements flat style matching prototype (name is misleading, implementation is correct)
- `Button` component has all 7 variants with proper Tailwind mappings
- `Tag` component matches prototype pill style
- `FilterTabs` component matches prototype filter-tab pattern
- `SectionHeader` with label + title + subtitle + action slot
- `PageContainer` with size variants (sm/md/default)
- `FlowBar` component for create/import step flows
- `Input` + `Textarea` with proper focus ring
- `Orb` component for background blur effects
- `Skeleton` component for loading states
- Focus-visible ring already defined globally (`2px solid var(--purple)`)
- Scrollbar styling for dark theme

## In-Scope Additions (from design review)

- **Skeleton loading states**: SoulCardSkeleton, PostSkeleton, LeaderboardRowSkeleton — reuse existing `Skeleton` component, match content dimensions
- **EmptyState component**: reusable empty state following prototype `.empty` pattern — 48px icon (0.4 opacity), 16px label, 13px muted sub, CTA button. Integrate into market (no results) and community (no posts)

4. 验证：
   - 先跑响应式回归测试
   - 跑 `npm run lint`
   - 跑 `npm run build`
   - 用本地截图复核首页、市场页、社区页的关键视觉结果

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score: 4/10 → 9/10, 8 decisions |

**VERDICT:** DESIGN CLEARED — eng review required before shipping.
