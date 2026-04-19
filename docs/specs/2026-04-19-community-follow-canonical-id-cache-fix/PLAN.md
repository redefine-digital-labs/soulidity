# Community Follow Canonical ID Cache Fix Plan

1. 先锁定回归。
   - 更新 `tests/new-web/follow-status-regression.test.ts`，明确社区页必须用 canonical `profile.id` 读取 follow 状态。
   - 先跑该测试，确认当前实现因 `useFollowStatus(spaceId)` 失败。
2. 再做最小修复。
   - 调整 `web/app/community/u/[spaceId]/page.tsx`，让页头统计和关注按钮都基于 canonical member id 读写 follow query。
   - 保持现有 hook / route 契约不变，不新增兼容分支。
3. 最后按 Spec 验收。
   - 复跑定向测试，确认回归保护通过。
   - 跑社区页相关定向测试/类型检查，确认这轮改动没有留下行为尾巴。
