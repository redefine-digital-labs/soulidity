# Desktop Extract Tab Order And Blackout Fix

## Goal

修复 desktop app 里 `Agent` / `Extract` tab 顺序不符合预期，以及点击 `Extract` 后在有本地 draft 的情况下设置区域会被整块黑色 backdrop 覆盖的问题。`Extract` 的 desktop mint/auth 能力必须保留，但不能在仅浏览或编辑 draft 时就 eager 挂载会注入全屏遮罩的 provider 树。

## Scope

- `desktop/apps/desktop/src/renderer/components/MainWindow/index.tsx`
  调整 tab 顺序，让 `Extract` 显示在 `Agent` 前面。
- `desktop/apps/desktop/src/renderer/components/MainWindow/ExtractTab.tsx`
  把 desktop mint/auth provider 改成显式懒加载，避免打开 `Extract` create step 时立即挂载 `PrivyProvider`。
- `tests/desktop/main-window.test.tsx`
  覆盖 tab 顺序和切换行为回归。
- `desktop/apps/desktop/src/renderer/components/MainWindow/ExtractTab.test.tsx`
  覆盖 saved draft / auth-ready 场景下 desktop mint 面板的懒加载回归。

## Acceptance

1. Desktop 主窗口 tab 顺序变成 `Settings -> Library -> Extract -> Agent -> Hooks`。
2. 点击 `Extract` 时，即使本地已有 saved draft 并直接进入 create step，也不会立即挂载 desktop mint/auth provider。
3. 在 desktop mint/auth 已配置完成的场景下，create step 先显示显式加载入口；只有用户主动进入 mint 面板后，才挂载 provider 并显示 `Mint on Sui` 控件。
4. 在 desktop mint/auth 未配置完成的场景下，仍然直接显示 blocker 文案，且不泄露原始 env var 名称。
5. 相关 targeted tests 和 typecheck 通过。
