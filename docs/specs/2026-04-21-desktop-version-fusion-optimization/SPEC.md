# Desktop 版本融合优化 Spec（实现版）

## Goal

把 V6 里定义的 3 个里程碑真正落成 desktop 代码：认证链路继续稳、宠物存在感可控、文件驱动任务执行与写入审批形成完整闭环，同时彻底移除 Quick Capture。

## Scope

- 保持 `getDesktopMe` 真实校验驱动的 auth/link 恢复链路，不回退到本地 token 假确认
- 为悬浮球补可持久化的 enhanced motion 开关，默认保持低打扰但状态可感知
- 任务执行器真实区分 `read-only` / `write`，write 默认先过显式审批
- 从 main / preload / renderer / shared / tests / spec 中彻底移除 Quick Capture 入口、store、IPC 和类型残留
- 增加针对性测试与根类型检查护栏

## Non-Goals

- 不扩成完整的桌面项目管理系统
- 不在本轮补新的浏览器/截图/剪贴板入口
- 不改动权限策略

## Acceptance

1. Settings 的链接恢复链路仍以 `getDesktopMe` 为确认真值，既有回归测试继续通过。
2. 悬浮球状态在低打扰模式下仍可感知，且 enhanced motion 开关可持久化。
3. 悬浮球不再暴露 Quick Capture 按钮、inbox 或相关运行态持久化；文件拖入后仍可进入任务面板。
4. `task-executor` 对 `read-only` / `write` 模式有真实约束；write 在启动前必须经过一次显式审批。
5. `npm run validate:v6-plan`、新增/相邻 desktop tests、`npm run typecheck:root` 通过。
