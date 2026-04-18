# Desktop Link Confirmation Validation Spec

## Goal

收口桌面端 `SettingsTab` 里“新建 link 后的确认轮询”路径，确保它和启动时“恢复已保存 desktop link”一样，只有在 `getDesktopMe()` 验证当前 desktop token 可用后才进入 `confirmed`。

## Scope

- `desktop/apps/desktop/src/renderer/components/MainWindow/SettingsTab.tsx`
- `desktop/apps/desktop/src/renderer/components/MainWindow/SettingsTab.test.tsx`

## Non-Goals

- 不改动启动时“恢复已保存 desktop link”的语义。
- 不改动桌面端 device link 协议、token 持久化格式或服务端 `/api/desktop/device/*`、`/api/desktop/me` 接口。
- 不扩展新的 UI phase；除非现有状态无法表达验收行为，否则保持现有 UI 结构。

## Constraints

- `devicePoll()` 返回 `confirmed` 后，不能先乐观展示 `confirmed` 再异步补 `getDesktopMe()`。
- 新建 link 的确认路径必须在进入 `confirmed` 前完成一次 `getDesktopMe()` 校验，并以其返回的身份数据作为展示来源。
- 如果确认轮询阶段的 `getDesktopMe()` 校验暂时失败，UI 不能误显示“已绑定”，并且不能提前停止 `devicePoll()` 的 confirmed 重试。
- 启动恢复路径仍然维持“先查本地 token，再用 `getDesktopMe()` 校验”的现有语义。

## Acceptance

1. 新建 link 轮询拿到 `confirmed` 后，在 `getDesktopMe()` 完成前仍不会显示 `Linked to account` / `Linked to Sui wallet`。
2. 新建 link 轮询拿到 `confirmed` 且 `getDesktopMe()` 成功后，`SettingsTab` 才进入 `confirmed`，并优先展示 `primarySuiAddress`。
3. 新建 link 轮询拿到 `confirmed` 但第一次 `getDesktopMe()` 校验失败时，`SettingsTab` 不会进入 `confirmed`，并会继续允许后续 poll 重试直到校验成功或用户取消。
4. 启动恢复已保存 desktop link 的既有测试语义保持不变。
