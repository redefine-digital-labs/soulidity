# Desktop Link Account JSON Response Fix

## Goal

修复 desktop 里点击 `Link to Web Account` 时，web 端返回 HTML/404 被主进程直接当 JSON 解析，导致用户看到 `Unexpected token '<'` 的问题。

## Scope

- `desktop/apps/desktop/src/main/*`
  抽取统一的 web 响应解析 helper，识别 HTML/404/非 JSON 响应并产出可诊断错误。
- `desktop/apps/desktop/src/main/index.ts`
  `device:start-link`、`device:poll` 以及复用同类 helper 的 desktop web API 代理改为统一解析路径。
- `tests/desktop/*`
  覆盖 HTML 404、JSON 成功、JSON 错误三类回归测试。

## Acceptance

1. `Link to Web Account` 遇到 HTML/404 时，不再抛出 `Unexpected token '<'`。
2. 报错必须明确指出：当前 web base URL 返回了 HTML/缺少 desktop API，而不是返回原始 JSON 解析异常。
3. device link 相关请求与 desktop auth 代理请求复用同一套 JSON 响应解析逻辑，避免同类问题重复出现。
4. 新增或更新的相关测试通过。
