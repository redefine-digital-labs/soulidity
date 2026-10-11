# Soulidity Phase Handoff: maker0178-425-native-accessory-rules

## Snapshot

- Created: 2026-10-09T01:55:25+03:00
- Phase: maker0178-425-native-accessory-rules
- Status: complete
- Goal: 完成P401–425的25实质原创部件、规则与真实试玩/导入；整体500继续
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (49 status entries)
- Handoff: `docs/codex/handoffs/20261009-015525-maker0178-425-native-accessory-rules.md`

## Outcome

425/500 QA_PASS，18区/429素材，4身体辅助计零。新增6耳饰/8胸针/6面纹/5场景，Maker-425原生425层像素和CRC PASS。131 REQUIRE+16互斥组编译155规则；13妆纹交叉新增互斥、P066/P174/P380全部胸针互斥。整体500 active，剩75。

## Scope and non-goals

### In scope

- 仅女性output/maker-cel-female-0178-2026-10-08；根CURRENT/BUG006、男性500及用户原件不动

### Intentionally not done

- 无commit/push/生产部署/外部消息/子代理/删除历史或原件授权

## Durable decisions

- 20细节用原生Qt/Krita结构绘制，五场景独立建筑；成对耳饰镜像、配色、坐标不计新项。P415/P419/P420越颊修正后30脸支撑PASS，30耳饰脸图及10耳垂锚点PASS。
- 240胸针/衣服实际审图中24因P066拉链/P174风挡扣片/P380两层交界拒绝，216批准。只读alpha全部在布面不代表结构相容，所以新增这三服装对所有胸针的EXCLUDE。自然旧痕/泪痣/鼻痕P416–418仍可搭妆容；装饰P415/P419/P420实际13交叉加入5互斥组。
- 新的测试须同时执行REQUIRE依赖处理和EXCLUDE移除，不能只查resolveDependentRequirements就宣称胸针已移除；所有1120胸针衣服规则全面检查。

## Changed paths and assets

### Changed paths

- output/maker-cel-female-0178-2026-10-08

### Image and binary assets

- output/maker-cel-female-0178-2026-10-08/source/Maker-425.kra
- output/maker-cel-female-0178-2026-10-08/qa/browser-425.png

### Relevant commits

- No additional commit references recorded.

## Verification

- Krita425 isolated per-layer native PNG match; file dimensions/IDs/hash/layer count/CRC | PASS
- Build425 author projections/39 body/4 holding/429 asset full ZIP roundtrip | PASS
- 2000 random/361seen,1120brooch garments,858hat hair,1200neck,404holding,660face accessories,572cosmetic;155native rules | PASS
- 25 actual new choices,320brooch menus,132cosmetic menus,12actual random viewed;both new automatic exclusions/reasons/exact selection and PNG Undo | PASS
- 425/429 actual author filechooser import;same recipe P318/P376/P383/P403/P410/P417/P421 transparent RGBA1024 exact d0711c5584db00dc82fae9e613daf3fb445ab7dd5fe7977423821b606d2d11ef;imported exclusions/Undo | PASS

## Risks and recovery

### Risks or blockers

- 500未完成。最后所有文档和handoff副本保存后再打包并核对live manifest；权威报告qa/material-library-validation.json。本批native25没有新增imagegen，66调用终结，425=286原生+139生成，账单credit/token未知。cell1001已完成不可等待/重启。

### Recovery or rollback points

- 试玩5197/Vite72171/browser2tab3 femalePreviewTab markDeliverable；CUA femaleChoose425已支持425，makerRoot是男性。Krita Scripter Editor12/Run3，exec(read_text UTF8,{})；中文read_text不省略encoding。一次CUA超时后观察同脚本已完成，未重启。合并总工程与原生重开分开，不重跑旧accept或foundation。

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

读取女性CURRENT及本handoff，继续P426起实质不同素材和必要规则至500，不提前complete。
