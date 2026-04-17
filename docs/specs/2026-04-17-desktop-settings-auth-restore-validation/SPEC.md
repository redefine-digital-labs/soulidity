# Desktop Settings Auth Restore Validation Spec

## Goal

修复桌面端 `SettingsTab` 重启后恢复绑定状态时只依赖本地 token/metadata 的回归，确保 Settings 展示的绑定态与真实桌面鉴权态一致，并且不会把可解绑的已持久化状态误隐藏。

## Scope

- `desktop/apps/desktop/src/renderer/components/MainWindow/SettingsTab.tsx`
- `desktop/apps/desktop/src/renderer/components/MainWindow/SettingsTab.test.tsx`
- 如有必要，新增一个仅服务于该恢复逻辑的 renderer 辅助模块

## Non-Goals

- 不改动桌面绑定协议、token 存储格式或服务端 desktop auth 接口
- 不重构 SettingsTab 里与钱包地址、密钥存储、手动发起绑定无关的 UI

## Constraints

- Settings 启动恢复绑定态时，不能仅凭 `getDesktopAuthStatus()` 的本地持久化结果直接判定“已绑定”。
- 只要本地存在 token，就必须用一次真实 desktop auth 请求校验当前凭证是否仍有效。
- 本地 token 仍有效但 metadata 缺失时，Settings 仍要恢复为“已绑定”，确保解绑入口可见。
- 本地 token 已失效或无法校验时，Settings 不能继续显示“已绑定”；如果本地仍有可清理的持久化状态，用户仍应能看到解绑入口。

## Acceptance

1. `SettingsTab` 在 `hasToken=true` 且 metadata 缺失时，会通过真实 desktop auth 恢复为 `confirmed`，并显示 `Unlink Device`。
2. `SettingsTab` 在本地 metadata 仍在但真实 desktop auth 校验失败时，不再显示 `confirmed`，且仍给出清理本地绑定状态的入口。
3. `SettingsTab` 在 `hasToken=false` 时保持 `idle`，且不会额外调用真实 desktop auth 校验。
4. 新增自动化测试覆盖以上 3 类恢复场景。
