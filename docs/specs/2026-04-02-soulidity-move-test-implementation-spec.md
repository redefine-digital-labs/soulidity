# Soulidity Move 协议测试实现 Spec

## 目标

基于 `docs/specs/2026-04-02-sui-move-e2e-case-table.md`，为 `move/soulidity` 补齐可执行的协议级端到端测试，覆盖 Soul 铸造、Collection/SC、Grant、Memory、Seal Policy 与交易结算主链路；按 TDD 方式先写失败测试，再补最小必要实现并完成验证，不留下半套用例或未收口分支。

## 范围

- `move/soulidity/sources/protocol_tests.move`
- `move/soulidity/sources/*.move` 中为测试收口所必需的最小实现或 `#[test_only]` 支撑

## 不在范围

- Web 前端、API、数据库、镜像层
- 与 case table 无关的重构

## 约束

- 优先复用现有 `protocol_tests.move` 场景与 helper，不平行新建第二套测试体系
- 新增断言以对象状态、权限校验、资金分配和关键失败路径为主
- 若现有合约已满足规格，只补测试，不为了“体现改动”而改生产逻辑
- 若为了可测性新增接口，默认限制在 `#[test_only]`

## 验收

1. `TC-01` 到 `TC-18` 的当前可验证场景，都有对应的 Move 协议测试覆盖或明确映射到既有测试并补足缺失断言。
2. 测试覆盖至少包含：native/import/joined Soul provenance、tradeable/non-tradeable collection、grant issue/reissue/revoke/expire、listing 期间 grant 保持有效、sale 后 owner 轮转并清 grant、creator royalty 与 collection royalty、首售 creator royalty surcharge 总价、memory append 权限与 append-only、seal document id 校验、collection add_soul 权限约束。
3. `sui move test --path move/soulidity` 通过；若用例暴露实现缺口，则同轮修复并重新验证。
4. 最终结果能回扣 case table，说明哪些是新增覆盖、哪些是复用扩展、哪些因规格未定继续排除。
