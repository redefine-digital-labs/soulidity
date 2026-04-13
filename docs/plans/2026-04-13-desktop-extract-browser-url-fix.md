# Desktop Extract Browser URL Fix

## Goal

修复 desktop Extract 的 “Open in Browser” 目标地址，避免把设备绑定页 `/desktop/link` 误拼成 `/desktop/link/create`，导致 web 端 404。

## Scope

- `desktop/apps/desktop/src/renderer/components/MainWindow/ExtractTab.tsx`
  Open in Browser 不再直接对 link URL 追加 `/create`。
- `desktop/apps/desktop/src/renderer/lib/*`
  抽取 create URL 解析 helper，基于 link URL 归一化到站点根下的 `/create`。
- `tests/desktop/*`
  覆盖 link URL → create URL 的回归测试。

## Acceptance

1. `https://host/desktop/link` 必须转换为 `https://host/create`。
2. 打开的 URL 保留 `?soulProfile=...` 参数。
3. 相关测试先红后绿。
