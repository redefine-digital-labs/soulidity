# Plan

1. 写失败测试，锁定 HTML/404、JSON success、JSON error 三种响应行为。
2. 抽取 desktop main web-response helper，统一处理响应体读取、JSON 解析、HTML 诊断与错误文案。
3. 在 `desktop/apps/desktop/src/main/index.ts` 接入 helper，替换 `device:start-link` / `device:poll` / `fetchDesktopJson` 的直接 `res.json()` 调用。
4. 跑相关测试，确认回归面只覆盖 desktop web 代理层。
