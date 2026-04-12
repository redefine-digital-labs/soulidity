# Review Fix Spec: 3e429b3

## Goal

修复提交 `3e429b3e5d12ba12ae2376500b2722231a5b2bf0` 中仍未收口的两个问题：

1. `articles.raw_item_id` 去重迁移必须更稳地保留当前真实在用的 canonical article。
2. Desktop 退出归档时必须避免 in-flight task 迟到回调把同一条 user turn 重复写入历史，且不能让关机过程继续推进队列。

## Scope

- `prisma/migrations/20260412120000_add_unique_raw_item_id_to_articles/**`
- `desktop/packages/backend/src/task-coordinator/**`
- `desktop/packages/backend/src/gateway/ws.ts`
- `desktop/packages/backend/src/index.ts`
- 相关最小回归测试

## Non-Goals

- 不重做整套 article 数据迁移策略，只修正当前 migration 的 canonical keep rule。
- 不改变 Desktop 正常运行时的任务顺序和持久化语义。
- 不扩展新的 shutdown UI / 用户提示。

## Constraints

- 保持最小充分改动。
- 迁移去重规则要覆盖当前仓库已存在的主要 article 使用信号，避免只看 `publications`。
- 关机语义以“保住 user turn、停止继续执行”为准，不在退出过程中继续产出新 assistant 消息。

## Acceptance

1. 去重 migration 的 keep rule 同时考虑至少以下 canonical 信号：`publications`、`posts`、`status='published'`、`pipeline_status='completed'`，再做稳定 tie-break。
2. 增加 migration 回归测试，锁定上述 keep rule 信号存在于 SQL 中。
3. Desktop backend 在 shutdown flush 前先停止 coordinator，running/queued task 不再在退出过程中触发 `pushMessages()`。
4. 增加 backend 回归测试，验证 shutdown 会按顺序抽出 running + queued user turn，并忽略 abort 后迟到的 `onDone`。
5. 相关测试通过，且不改动无关运行时权限策略。
