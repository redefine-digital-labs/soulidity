# Desktop Startup 404 And Tabs Fix

## Goal

修复 desktop 打包版启动时的 404 噪声，以及 MainWindow 中 tab 在 frameless 窗口下可能被误判为拖拽区域导致无法点击的问题。

## Scope

- `desktop/apps/desktop/src/main/*`
  将 auto-updater 对 GitHub `latest-mac.yml` 的 benign 404 归一化为“无更新”，避免启动时报错。
- `desktop/apps/desktop/src/renderer/components/MainWindow/styles.css`
  为 tabs/body 显式标注 `-webkit-app-region: no-drag`。
- `tests/desktop/*`
  覆盖 updater 404 归一化和 MainWindow tab 切换行为。

## Acceptance

1. `https://github.com/fabw222/clawnews/releases/latest/download/latest-mac.yml` 返回 404 时，desktop 启动不再把它当错误状态展示。
2. MainWindow tab 区域明确是 `no-drag`，不会因 frameless drag region 导致点击失效。
3. 相关测试通过。
