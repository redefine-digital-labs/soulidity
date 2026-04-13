# Desktop Extract Scan Fix

## Goal

修复 desktop MainWindow 的 Extract 流程，确保本地扫描在遇到异常 Codex 日志时不会整体失败，且 UI 展示真实错误而不是误报 `Scan IPC not available`。

## Scope

- `desktop/apps/desktop/src/main/soul-extraction/parsers/codex.ts`
  对畸形 `response_item` / `event_msg` 输入做空值防御，避免 parser 直接抛错。
- `desktop/apps/desktop/src/main/soul-extraction/session-scanner.ts`
  单文件解析隔离，坏文件跳过并通过 progress/error 暴露，不拖垮整轮扫描。
- `desktop/apps/desktop/src/renderer/components/MainWindow/ExtractTab.tsx`
  区分“IPC 方法缺失”和“IPC 调用失败”，真实错误直接透传给用户。
- `tests/desktop/*`
  增加 parser / scan / renderer 行为回归测试。

## Acceptance

1. Codex 日志里出现缺少 `item` 的 `response_item` 时，扫描不会抛出 `Cannot read properties of undefined`。
2. 单个坏日志文件不会让整个 `scanSessions()` reject；其他 agent / 文件仍能继续扫描。
3. Extract 页在 IPC 存在但调用失败时显示真实错误文案，而不是固定提示 “companion up to date?”。
4. 相关测试能先红后绿，并覆盖上述回归场景。
