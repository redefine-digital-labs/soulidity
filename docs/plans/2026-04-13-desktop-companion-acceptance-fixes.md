# Desktop Companion Acceptance Fixes

## Goal

收口 Phase 1.5 验收中剩余的 4 个问题：

- 多 agent 聚合按优先级而不是最近更新时间
- CLI / 交互驱动的 mood 链路完整接通
- `getCurrentAgentStatus()` 与广播路径一致做 session 去重
- `agentAddress` 设备绑定链路补齐针对性测试

## Scope

### Desktop

- `desktop/packages/shared/src/types/cli-status.ts`
  统一 CLI 聚合规则，给 renderer / main 复用
- `desktop/apps/desktop/src/main/status-watcher.ts`
  读/播统一走 dedup 后的状态
- `desktop/apps/desktop/src/main/index.ts`
  将 agent 状态变化接到 `moodService`
- `desktop/apps/desktop/src/preload/index.ts`
  暴露 mood 变更订阅
- `desktop/apps/desktop/src/renderer/env.d.ts`
  补齐 preload 类型
- `desktop/apps/desktop/src/renderer/hooks/useCliStatus.ts`
  改用共享聚合规则
- `desktop/apps/desktop/src/renderer/hooks/useMood.ts`
  订阅 mood 推送，避免 15s 轮询延迟
- `desktop/apps/desktop/src/renderer/components/FloatingBall/index.tsx`
  点击时上报 `moodInteract`

### Tests

- `tests/desktop/cli-status-types.test.ts`
- `tests/desktop/status-watcher.test.ts`
- `tests/desktop/use-mood.test.tsx`
- `tests/desktop/floating-ball.test.tsx`
- `tests/new-web/desktop-device-session.test.ts`
- `tests/new-web/desktop-device-routes.test.ts`
- `tests/new-web/desktop-profile-service.test.ts`
- `tests/new-web/desktop-profile-routes.test.ts`

## Acceptance Mapping

- Spec #8: 多 agent 并行正确聚合
- Spec #9: 12 mood 系统由 CLI / 点击交互真实驱动
- Spec #11: `agentAddress` 绑定链路有明确测试覆盖
