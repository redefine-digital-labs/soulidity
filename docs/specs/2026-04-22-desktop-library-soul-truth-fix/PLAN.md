# Plan

1. 在 desktop repository 为 Soul 引入动态 catalog source：listed Soul 自动进入 desktop marketplace，owned Soul 可按 sourceRef 直接解析 manifest。
2. 保持 starter persona 仍由显式 `desktop_catalog_entries` 控制，避免把桌面 curated starter 逻辑一起改掉。
3. 给 `/api/desktop/catalog/[id]` 增加动态 Soul access 边界：public listed 直出，held/floor-violation 先过 desktop auth + access check。
4. 跑相关 repository / route 测试，确认 desktop Library 的 web truth 对齐且没有扩大未上架 Soul 的公开访问面。
