# Soulidity Phase Handoff: modular-ecosystem-gate0

## Snapshot

- Created: 2026-10-10T14:48:50+03:00
- Phase: modular-ecosystem-gate0
- Status: in-progress
- Goal: Continue complete all-contract goal; Gate0 trace, exact source/authority and owned-only creation proof
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (27 status entries)
- Handoff: `docs/codex/handoffs/20261010-modular-ecosystem-gate0.md`

## Outcome

157 original/live/registry IDs preserved; 25 actual selectors; original30/1528 duties retained:69 reviewed1459pending. 9 packages52Move+9manifests+6locks=67inputs; current2067production/65test-only separate.49 agent artifact files integrated by SHA. D26 production probes partial; round5FAIL remains, no consumer switch/new signing. Fresh target prior9 local publishes/bootstrap/2of6 births/1138VM/385foreign all_verified retained. Feedback flagged turn13089ms/additionalDetailsnull; report prepared, not submitted. Full goal active.

## Scope and non-goals

### In scope

- Local reversible modular construction and scoped isolated agents; existing retained test keys/virtual gas only

### Intentionally not done

- No new remote creation, Git, production, real keys/funds, AgentPass or irreversible privileges

## Durable decisions

- Gate0 is not passed; source/live preservation and declaration existence are not semantics or independent release

## Changed paths and assets

### Changed paths

- scripts/ecosystem
- docs/ecosystem-construction
- docs/codex/PROJECT_MEMORY.md
- docs/CONTRACT_REBUILD_SPEC_CN.md
- output/ecosystem-construction/gate0-2026-10-10
- output/feedback-review-2026-10-10

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- 157 source/live/registry identities and responsibility text preserved; 52 file/module/SHA crosscheck; current inventory lines and source freeze; original queues byte-preserved
- D26 baseline shared-root and wallet-initialization production compile PASS; round5all_expected_results=false; runtime Not run

## Risks and recovery

### Risks or blockers

- Gate0 effective authority and independent release/B0 pending; D26 container exit unclosed; main package margin597;1459original duties pending

### Recovery or rollback points

- No consumer switch or new chain transaction in Gate0; retained node/DB/Genesis/keys/receipts and unsafe/failed rounds kept; primary CURRENT untouched

### Working-tree evidence

```text
?? docs/CONTRACT_REBUILD_COVERAGE.json
?? docs/CONTRACT_REBUILD_SPEC_CN.md
?? docs/CONTRACT_SECURITY_REVIEW_CN.md
?? docs/SOUL_ARCHITECTURE_REVIEW_CN.md
?? docs/SOUL_STANDARD_KERNEL_CN.md
?? docs/codex/
?? docs/ecosystem-construction/
?? move/soulidity_application/
?? move/soulidity_community/
?? move/soulidity_content/
?? move/soulidity_foundation/
?? move/soulidity_model/
?? move/soulidity_native/
?? move/soulidity_standard/
?? move/soulidity_v1/
?? move/soulidity_visual/
?? move/standard_examples/
?? output/
?? scripts/codex/
?? scripts/ecosystem/
?? scripts/inspect_contract_dependencies.py
?? scripts/profile_move_function_trace.py
?? scripts/verify_contract_ability_batches.py
?? scripts/verify_contract_ability_probes.py
?? scripts/verify_contract_publication_budget.py
?? scripts/verify_soul_standard_external.py
?? scripts/verify_soul_standard_local.mjs
```

## Exact next action

Read docs/ecosystem-construction/GATE0_STATUS_CN.md and gate0 artifacts. Verify running retained node and cached intents first. Fix D26 probe syntax/primary expectations; preserve unsafe custody candidate FAIL, narrow wallet Creation candidate, production cross-package and actual owned/custody proof before ABI freeze or consumer switch. Complete remaining Gate0 effective authority/release mapping, B0 minimal coherent market and CASE19 frozen identities. Retain157 IDs/Owners and1459 original pending; do not replace all-contract goal. Construction handoff v1.1 permits scoped agents/SDK/local reversible work; no remote/Git/production/real funds/AgentPass.

## 最新续接收尾：2026-10-10，时区 UTC+03:00

接管任务：「梳理合约模块与权限边界」`01a12471-0cca-78b0-b818-56d99464068e`。本任务结束反馈/整理轮，不再启动代码修改、测试、发布或子代理。完整所有合约目标仍在进行；此处没有提交、部署、重置或清理。

- 实际工作树：`/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`；当前入口 `docs/codex/CURRENT.md`；唯一 handoff 即本文件。设计树 CURRENT 未修改。
- 本阶段写入：`scripts/ecosystem/`（4份集成 inventory/mapping 脚本及 owned-creation 验证脚本）；`docs/ecosystem-construction/GATE0_STATUS_CN.md`；`docs/CONTRACT_REBUILD_SPEC_CN.md` 与 `docs/codex/PROJECT_MEMORY.md` 授权说明；`output/ecosystem-construction/gate0-2026-10-10/`（49份 SHA 集成 artifacts、Slack before snapshot、owned-creation 原失败轮次）；`output/feedback-review-2026-10-10/REPORT_CN.md`、`EMAIL_CN.txt`、`email-send-receipt.json`；本 CURRENT/handoff。另保留本轮已完成的 `output/reports/2026-10-10-feynman-native-target/` 报告及 PlantUML/SVG/PNG/HTML。
- 最后只读进程核查：仅保留本地 Sui 节点 PID `29546`，RPC `19089`，链 `ae60751d`、协议137；配置 `output/contract-rebuild/certified-capacity-ptb-2026-10-09/local-network`，原 DB/Genesis/keys 保留。未发现 owned-creation/native-target 测试执行进程；三个 Gate0 Agent 已结束；两个隔离工作树保留，不清理。接管先重新确认 PID/RPC，不另起节点。
- D26 `owned-creation-round5/evidence.json`：`all_expected_results=false`，完整关口未过、runtime Not run、公开 ABI 未冻结、无消费者切换。baseline fresh-root 可 shared 的生产编译、wallet 初始化、候选 Kiosk 出口及部分负例已有 compile PASS。未解决：可变引用实际 EC04006 与期待 EC04007 不符；share_object 实际 ESC02009 与期待 EC05001 不符；`copy *r` 是 EC01013 语法错，不能当反绕过证明；Kiosk 链式退出 probe 的 `confirm_request` 元组接收错误 EC04005。需修正 probe，再验证 custody 路径；empty-policy purchase→confirm→share 的风险目前是源码分析，不能宣称实际绕过已运行。保留 round1–5 失败记录，wallet-only 候选尚未运行。真实 Standard/业务源码未切换到 Creation。
- 已成功本地链操作，仅历史回执：`output/contract-rebuild/native-target-local-2026-10-10/published.json` 的9一致 fresh packages、bootstrap Config/Registry/Standard Publisher/TransferPolicy 及 issuer guards；`birth-progress.json` 仅 case0/1完成（2/6），真实 Soul/DOF/原对象ID/Kiosk readback；1138 VM PASS；`final-foreign385-r1/evidence.json` 中385 foreign `all_verified=true`。这些不是生产部署、全旅程或整体重构完成。
- **禁止重复付款/未知意图重放**：case0/1 完成 digest 以 `birth-progress.json` 为准（case0 `62rMxmTPG8SGh722jWMoaC17tWERfUXXpPFS4AiH9NbL`）。原 case2 pure-arg 拒绝 digest `AeoaxNChEoPCrAYyzhumofsJSaoBKdu1c54CyKsFr9Bg` 的独立证据 `protocol-input-rejection-proof.json`：未发现交易、nonce未占用、gas余额未变、实际执行false/gas0；原 intent/cache 不删除、不重放。case2 已付/认证 blob/WAL 回执留存，不重新支付。分块替代脚本已改但未运行，若接管继续须用新的 `birth-2-complete-chunked` 意图并先核旧回执。其他不明交易先按已有 local_runtime 恢复流程核查，不重签。
- 反馈邮件已按用户直接授权，于14:51:52 +03:00发往 `support@openai.com`，Gmail ID `1a125a7bf718a49c`，回读 `SENT`；正文仅时间设置写作“时区：Europe/Moscow（UTC+03:00）”，不把时区当地区。没有工单号/复核结论；应用 `/feedback` 未另提交。邮件支持行为不是生产签名授权。

接管后沿原完整目标继续：157原记录及原 Owner/验收保留，69/1528已审与1459待审保留；Gate0有效权限/独立发布映射、D25–D32、B0/CASE19、视觉原旅程及原职责仍未完成。本任务此后不再写共享工作树。

## 实际拆仓里程碑（2026-10-10；当前主线）

唯一协调任务继续为01a12471-0cca-78b0-b818-56d99464068e，旧创建验证优先级仅属历史。10个独立本地Git仓位于 `/Users/naoer/Documents/Claude/Projects/soulidity-ecosystem`，进度及每仓入口见 `README_CN.md` 和 `workspace.json`。无commit/remote/push/生产切换。Standard、Community、Visual已迁唯一源码权威，旧路径为定位symlink，52个接管生产源码SHA未变；旧整包保留在 `output/ecosystem-construction/repository-split-2026-10-10/frozen-before`。独立生产build四包PASS，VM26/0/0/0；保留Core消费者生产buildPASS。Model候选仍prepared，Foundation混合依赖尚未切换。

市场独立候选完整迁入soul-market；本仓生产build+44/44跨包VM+本地product CI PASS，链上消费者未切。174源码相同，依赖local路径使未发布占位地址变化，174模块地址重定位后逐字节相同、raw52变化，不同部署身份不得等同；见市场 evidence/address-relocation-review。Core锁后续build刷新已另存post-extraction-lock-refresh说明，旧locks保留。DevOps三个实际工具权威迁入，旧脚本路径为symlink。10仓管理/Agent/CI配置+14模板测试均为本地，不是人员授权/远端运行/链上治理完成。

下一执行为Content混合拆分与Maker/Native/Operator/Custody循环的准确公开契约；严禁为了build导出Cap/UID或删授权守卫。Channel没有独立实现，SDK/Integration尚未迁入，剩余原1459 duties继续。D26unsafe custody仍FAIL，Gate0/B0/CASE19/full product pending；仓库增量不关闭完整goal。
