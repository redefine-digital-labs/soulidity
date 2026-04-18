# Desktop Link Confirmation Validation Plan

1. 先锁定回归。
   - 调整 `SettingsTab` 的 renderer 测试，覆盖“确认轮询后等待 `getDesktopMe()` 才能进入 `confirmed`”和“第一次校验失败后继续 poll 重试，而不是提前停轮询”。
2. 再做最小修复。
   - 去掉新建 link 轮询分支里“先 `confirmed`、后异步 hydration”的乐观路径。
   - 让确认轮询与启动恢复共用同一类身份解析语义：先 `getDesktopMe()`，再决定是否进入 `confirmed`。
   - 修正 confirmed 轮询的停止时机：只有本地校验真正成功后才停轮询，保留 confirmed 重试能力。
3. 最后按 Spec 验收。
   - 运行定向 `vitest`。
   - 运行桌面端 `typecheck`。
