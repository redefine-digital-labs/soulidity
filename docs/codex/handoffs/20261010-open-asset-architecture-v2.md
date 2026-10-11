# Soulidity Phase Handoff: open-asset-architecture-v2

## Snapshot

- Created: 2026-10-10T10:11:14+03:00
- Phase: open-asset-architecture-v2
- Status: complete
- Goal: 完成开放 Maker/Soul、可选商业协议、独立业务与可替换客户端的新架构说明
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (49 status entries)
- Handoff: `docs/codex/handoffs/20261010-open-asset-architecture-v2.md`

## Outcome

完成 docs/SOULIDITY_OPEN_ECOSYSTEM_RD_ADDENDUM_CN.md v2.0：区分用户已确认方向、推荐策略、当前实现与待验证事项；覆盖独立资产、限范围非独家分销、对象权限、升级治理、Sui/Walrus/Seal 边界及原旅程接替验收。仅说明工作完成，原合约重构和生产交付未关闭。

## Scope and non-goals

### In scope

- 复盘产品边界、独立资产与商业接入、权限治理、无自有业务后台及平台断开后的原旅程接替

### Intentionally not done

- 不修改合约、生产、密钥、资产、远端任务或其他研发 CURRENT；不提交、推送、签名或部署

## Durable decisions

- 五个板块是产品入口；推荐底层按独立资产、对象范围内权利协议、业务实例和客户端拆分
- Maker 和 Soul 独立；分销默认非独家且限制版本范围；退出停止新增业务并保留已购权利和既有收入
- 收费、服务管理和包升级分别治理；标准核心不强制平台收费、全局许可或全生态暂停
- 续期和解密有真实基础设施条件；必须演练替代客户端、对象权限和原意图恢复，不以链上存在替代产品验收

## Changed paths and assets

### Changed paths

- docs/SOULIDITY_OPEN_ECOSYSTEM_RD_ADDENDUM_CN.md
- output/open-ecosystem-design-2026-10-10

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- document-verification.json:17 sections,8 local links,7 source paths,coverage review PASS
- Primary CURRENT,PROJECT_MEMORY and contract-worktree CURRENT exact hashes preserved PASS
- Historical v1.1 backup hash matches original document PASS

## Risks and recovery

### Risks or blockers

- 当前 Maker/Product 仍有平台 Config 与经济策略耦合；本地门控升级证据不证明开放资产目标实现或生产完成
- 实际新收费、多签参数、永久升级限制、密钥恢复和不兼容类型迁移仍需原评审与发布前确认

### Recovery or rollback points

- output/open-ecosystem-design-2026-10-10/previous-v1.1.md

### Working-tree evidence

```text
 M .gitignore
 M CONTEXT.md
 M README.md
 M agent-management/README.md
 M agent-management/foundation/README.md
 M agent-management/foundation/ai-roles/brand-growth.md
 M agent-management/foundation/ai-roles/community.md
 M agent-management/foundation/alex.md
 M agent-management/foundation/ann.md
 M agent-management/foundation/head.md
 M agent-management/foundation/trinity.md
 M agent-management/foundation/wayne.md
 M agent-management/image-prompts.md
 M agent-management/labs/README.md
 M agent-management/labs/ai-roles/backend.md
 M agent-management/labs/ai-roles/cto.md
 M agent-management/labs/ai-roles/frontend.md
 M agent-management/labs/ai-roles/fullstack.md
 M agent-management/labs/ai-roles/pm.md
 M agent-management/labs/hunter.md
 M agent-management/milestones.md
 M agent-management/shared/bd-priorities.md
 M agent-management/shared/context-sync.md
 M agent-management/shared/decision-log.md
 M agent-management/soul-team.html
?? .pnpm-store/
?? AGENTS.md
?? agent-management/BUG_REVIEW.md
?? agent-management/EXECUTION_POLICY.md
?? agent-management/LIVE_PRODUCT_STATE.md
?? agent-management/M0_BASELINE.md
?? agent-management/OPERATING_MODEL.md
?? agent-management/PRODUCT_ENGINEERING_HANDBOOK_CN.md
?? agent-management/agent-registry.json
?? agent-management/creator-registry.json
?? agent-management/creators/
?? agent-management/evidence/
?? agent-management/history/
?? agent-management/roles/
?? agent-management/runs/
... 9 additional status entries omitted
```

## Exact next action

研发新任务以本交接和 v2.0 说明为输入，先读取现有合约工作树 CURRENT 及其唯一交接，在原职责和 Delivery/DEV/BUG 记录上完成依赖、权利、迁移及逐旅程验收的差距映射。
