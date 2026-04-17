# Desktop Settings Auth Restore Validation Plan

1. 先锁定回归。
   - 给 `SettingsTab` 增加 renderer 测试，覆盖无 token、token 有效但 metadata 缺失、token 失效但 metadata 仍在三类场景。
2. 再做最小修复。
   - 调整 Settings 初始化恢复逻辑：先读本地状态，再在存在 token 时调用真实 desktop auth 校验。
   - 对“校验失败但本地仍有持久化状态”的场景保留解绑入口，避免用户无法清理本地状态。
3. 最后按 Spec 验收。
   - 运行定向 vitest。
   - 运行桌面端 typecheck，确认新增状态分支和 IPC 类型没有残留问题。
