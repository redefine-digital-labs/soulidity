# Soulidity Coverage And Upgrade Hardening Design

**Goal:** 收口 `content_access` 删除错误码后的残留，并补齐 `move/soulidity` 当前缺失的覆盖率证据、重入安全验证、升级预留机制、回滚/锁定方案与测试。

**Scope:**
- `move/soulidity/sources/content_access.move`
- `move/soulidity/sources/market.move`
- `move/soulidity/sources/protocol_tests.move`
- 与本轮实现直接冲突的计划/文档残留

**Constraints:**
- 本轮按最新用户要求收口：`content_access` 错误码编号改为连续值，源码、测试、文档口径必须同步更新。
- 优先补“可验证证据”，避免只写审计式结论。
- 新增升级预留以 Sui/Move 原生能力为主，不引入 EVM 风格假 proxy。

**Observed Facts:**
- `content_access.move` 已删除 `EAccessExpired` 与 `EIncorrectPaymentAmount` 的运行时定义，用户进一步要求把剩余错误码编号理顺为连续值。
- 运行时代码未再引用这两个旧错误码，但计划文档仍保留旧定义与旧支付断言。
- 当前本机 `sui` CLI 未开启 `tracing` feature，不能直接执行 `sui move test --coverage`。
- `move/soulidity` 现有测试覆盖了空值、溢出、权限异常，但没有明确的“重入不可能/被拒绝”测试；升级预留只有 `MarketAdminCap`。
- 运行时已经具备两级治理开关：`update_paused` 用于可恢复暂停市场入口，`freeze_upgrades` 用于把 package upgrade cap 永久做成 immutable。
- 用户已确认 Gas 费用估算完成，主网费用可接受；本轮不再重复做链外估算，只把该结论纳入验收说明。

**Design Decisions:**
1. `content_access` 错误码改为连续编号，并同步清理所有源码/文档中关于 retired 编号的解释。
2. 清理所有仍然声明或示意旧错误码的文档残留，避免设计文档和现状分叉。
3. 重入补齐不走“伪攻击合约”路线，而是补一条基于 Sui 对象模型和状态机边界的测试/文档化验证，证明关键入口不存在回调重入面。
4. 升级预留补齐采用 capability custody 方案：把 package upgrade 治理对象显式建模为受 admin cap 控制的 shared object，并为配置变更/冻结策略写测试；不引入仓库内不存在的 proxy 架构。
5. 覆盖率证据优先尝试使用带 `tracing` 的工具链；若当前环境无法在合理时间内完成构建，则输出受限结论并保留可执行获取路径。
6. 回滚方案分成两级：
   - 紧急暂停：由 `MarketAdminCap` 持有人调用 `market::update_paused(..., true)`，先冻结市场入口，待回归验证后可用 `false` 恢复。
   - 永久锁定：若决定停止后续升级，由 `MarketAdminCap` 持有人调用 `market::freeze_upgrades(...)`，把 upgrade cap 做成 immutable；这是不可逆动作，只能在确认当前版本可长期保留时执行。
7. 建议的事故处置顺序固定为：先暂停交易入口，再决定走“修复后恢复”还是“冻结当前版本”，避免一边开放入口一边处理升级治理。

**Rollback Runbook:**
1. 紧急止血：
   - 使用 `MarketAdminCap` 调用 `market::update_paused(&mut config, &admin_cap, true)`。
   - 预期效果：新的个人 kiosk 初始化、复绑、Soul/Collection 挂单、购买、内容访问购买都会在市场层直接 abort。
2. 故障分流：
   - 若问题只在运营/前端层，保持 `paused = true`，修复链下依赖后再恢复。
   - 若问题在链上逻辑但可修复，保持 `paused = true`，按 `track_upgrade_cap -> authorize_upgrade -> commit_upgrade` 完成升级验证后，再 `update_paused(..., false)` 恢复。
3. 永久锁定：
   - 若确认当前版本需要长期冻结，调用 `market::freeze_upgrades(&mut upgrade_state, &admin_cap, upgrade_cap)`。
   - 预期效果：upgrade cap 被 `package::make_immutable` 消耗，后续所有 `track/restrict/authorize/commit` 路径都会被 `EUpgradesImmutable` 拦住。
4. 回滚边界：
   - `pause` 是可逆的运维开关。
   - `freeze_upgrades` 是不可逆锁定，不存在链上解锁路径；真正的回滚点只在执行 freeze 之前。

**Acceptance:**
- `content_access` 的错误码删除不存在源码、测试、文档尾巴，剩余错误码编号连续且所有引用口径一致。
- 增加一条能支撑“无重入向量”结论的测试或等价可执行验证。
- 升级预留机制有明确实现与测试，至少覆盖 admin 控制面与升级治理状态。
- 给出可执行的回滚/锁定方案，明确哪些动作可逆、哪些动作不可逆。
- 记录 Gas 结论为“主网费用可接受”。
- 给出 fresh 的测试/覆盖率验证结果；若无法拿到百分比，必须明确阻塞原因和下一步命令，不能伪称达标。
