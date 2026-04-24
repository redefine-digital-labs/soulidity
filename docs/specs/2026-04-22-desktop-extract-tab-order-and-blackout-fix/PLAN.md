# Plan

1. 调整 `MainWindow` 的 tab 常量与渲染顺序，把 `Extract` 移到 `Agent` 前面。
2. 在 `ExtractTab` 里保留 runtime config 预检，但将 `DesktopMintProviders` 改为显式懒加载，只在用户点击进入 desktop mint 面板后再挂载。
3. 补充定向测试，分别卡住 tab 顺序和 auth-ready draft 场景下 `Mint on Sui` 的懒加载行为。
4. 跑 focused vitest 与 desktop typecheck，确认没有引入新的桌面回归。
