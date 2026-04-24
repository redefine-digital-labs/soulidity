# Desktop Library Remote Image Fix

## Goal

修复 packaged desktop app 的 Library 页面无法显示远端 Soul 缩略图的问题。当前 desktop Library 使用 web catalog 返回的 `thumbnail` / `coverImage` 直出到 `<img>`，因此 renderer 安全策略必须允许这些远端 HTTPS 图片以及桌面现有的数据 URL / 本地文件图片来源。

## Scope

- `desktop/apps/desktop/src/renderer/index.html`
  调整 renderer Content Security Policy，允许 desktop Library 和相邻图片入口使用 `https:`、`data:`、`blob:`、`file:` 图片源，同时保持脚本仍限制在本地 bundle。
- `tests/desktop/renderer-csp.test.ts`
  增加 targeted regression，防止未来再次把 remote/data image source 从 desktop renderer CSP 中删掉。

## Acceptance

1. Packaged desktop renderer 不再因 CSP 拦截 Library 中来自 `https://...` 的 Soul 缩略图。
2. 现有 renderer 内的 data URL / file URL 图片来源不会被新 CSP 误伤。
3. 脚本执行边界仍保持 `script-src 'self'`，不因为修图片而放大脚本 blast radius。
4. 相关 targeted test 通过。
