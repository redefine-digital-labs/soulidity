# Soulidity Move 协议测试实现 Plan

1. 建立 case table 到现有测试与模块入口的映射。
   - 复用 `stale_grant_cannot_be_used_after_soul_sale`
   - 复用 `collection_holder_receives_extra_royalty_on_soul_resale`
   - 复用 `import_and_personal_join_set_expected_provenance`

2. 先写失败测试，优先补主链路与高风险权限场景。
   - Native / imported / joined mint 与 founding memory
   - Collection 创建、绑定、不可交易 listing 失败、holder 仅获版税权
   - Grant issue / reissue / revoke / expiry
   - Listing 期间 grant 保持有效，成交后清 grant
   - Creator 首售 surcharge 计入总价
   - Memory append 与 seal document id 校验
   - add_soul creator/creator-match/duplicate-bind 约束

3. 仅在测试失败确认为实现缺口时，补最小充分代码。
   - 优先 `#[test_only]` 支撑
   - 生产逻辑只修与 case table 直接相关的差异

4. 运行验证并回扣 Spec。
   - `sui move test --path move/soulidity`
   - 整理 case table 覆盖映射与剩余边界
