# Soulidity Phase Handoff: Soul DOF v1 fresh design and visual policy

## Snapshot

- Created: 2026-10-07T15:34:49+03:00
- Phase: Soul DOF v1 fresh design and visual policy
- Status: complete
- Goal: 固化允许全新部署的Soul DOF对象模型、可取出与整体交接语义、视觉适配及受约束微调方案，并验证最小Move持有原型；仅此研究边界。
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (49 status entries)
- Handoff: `docs/codex/handoffs/2026-10-07-soul-dof-v1-visual-plan.md`

## Outcome

新目标文档取代旧版兼容要求；DOF原生持有原型通过10项Move测试和生产模式构建。视觉标准明确坐标／锚点依赖、替换与叠加、Empty、适配、微调和交易布局交接；视觉功能仅为设计，尚未实现或验收。完整项目未完成，未变更生产合约或活动Owner。

## Scope and non-goals

### In scope

- 本地标准文档、独立work/soul-dof-v1研究原型、定向渲染源码核对与证据。

### Intentionally not done

- 没有部署、链上写入、付款、签名、Git提交／推送／PR或外部消息；没有实现新画布、适配器或完整发行／市场。

## Durable decisions

- 用户允许完整重构和新部署，不需要旧ABI、对象ID、Loadout或Pass迁移兼容；保留确认的产品及商业政策。
- Soul为key+store拥有型根；Core／Composition及真实Item用DOF，参数与激活绑定为值。withdraw返回原对象ID，整套交接包含未激活库存。
- 推荐自动适配＋受约束微调；有效范围为槽位策略、Item许可和适配验证范围的交集。参数保存到Composition，不新增配置NFT。
- 整套出售保存布局随Soul交接；取出／停用清除宿主微调；换Item或跨Maker重新适配。替换组、空槽及锚点依赖必须显式声明。
- 视觉纵向验证前置到上游商业／市场扩展之前；合约测试不构成视觉或生产安全验收。

## Changed paths and assets

### Changed paths

- docs/SOUL_DOF_V1_REBUILD_CN.md
- docs/SOULIDITY_ASSET_STANDARD_CN.md
- docs/ANIMACRAFT_SLOT_SYSTEM_PLAN_CN.md
- docs/codex/handoffs/2026-10-07-asset-standard-plan.md
- work/soul-dof-v1/Move.toml; Move.lock; sources/soul.move; tests/assets.move; tests/soul_tests.move; README.md
- output/asset-standard-2026-10-07/dof-prototype-evidence.json; dof-prototype-test.log; dof-prototype-build.log

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- sui move test --path work/soul-dof-v1: 10/10 PASS
- sui move build --path work/soul-dof-v1: production-mode exit 0 PASS
- 4 documents / 37 local links / 11 source and artifact hashes / JSON evidence PASS

## Risks and recovery

### Risks or blockers

- 尚未实现VisualAdapter、ContentRef、PlacementOverride、微调画布、付费资格／USDC、Seal、市场清单／规则或第三方独立容器验收。
- Kiosk仅无规则测试Policy和测试SUI；嵌套容器为同包测试模块；500容量尚未完成Gas／上限验证；无独立审计。

### Recovery or rollback points

- 研究原型隔离在work/soul-dof-v1；保留全部旧源码、资产及只读证据，不回滚或覆盖其他工作树。
- 主docs/codex/CURRENT.md仍指向20261007-092423-bug006-exact-candidate-deploy.md，不改变未完成的M1–M4主交付状态。

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

按docs/SOUL_DOF_V1_REBUILD_CN.md第3节与步骤2，选择两个不同画布／锚点的Maker真实素材，完成scene／binding到recipe及受约束微调的本地纵向验证，再固化链上保存ABI。保持当前BUG006/F02钱包、Owner和主CURRENT指针。
