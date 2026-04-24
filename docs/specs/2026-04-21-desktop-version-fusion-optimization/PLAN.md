# Plan（V6 真落地）

1. 保持 `P0-auth-link-hardening` 已有正确性，不回退 `getDesktopMe` 真实校验与恢复测试。
2. 为 `P0-presence-minimum-loop` 增加可持久化的 enhanced motion 开关，并在 reduced mode 下保持状态可感知。
3. 从 `P1-light-task-closure` 中移除 quick capture 主进程 store、renderer inbox 和多窗口广播。
4. 升级 `task-executor` 为真实 `read-only` / `write` 双模式；write 默认先走一次 preflight approval。
5. 在 FloatingBall 中移除 quick capture 入口与保存态，只保留文件拖入后的审批执行面板。
6. 在 ExtractTab 中清理 inbox 视图，恢复为聚焦灵魂提取工作流。
7. 新增针对性测试并跑 `validate:v6-plan`、desktop tests、`typecheck:root`、全量 `npm test`。
