from pathlib import Path
import json
root=Path('/Users/naoer/Documents/Claude/Projects/soulidity')
ac=root/'tmp/animacraft-v8-mainnet-release'
so=Path('/Users/naoer/.codex/worktrees/f722/soulidity')
changed=[]
def append(p,s):
 p=Path(p); old=p.read_text(); marker=s.strip().splitlines()[0]
 if marker not in old:
  p.write_text(old.rstrip()+'\n\n'+s.strip()+'\n'); changed.append(str(p))
section='''## 8. 敏捷 + DevOps 八阶段统一执行协议（2026-10-05 用户确认）

适用于项目的产品、商业、设计、研发、测试、发布、运行与反馈。唯一主循环：
**Plan → Code → Build → Test → Release → Deploy → Operate → Monitor → Plan**。
敏捷负责目标、优先级、小批量交付、评审和回顾；八阶段负责该增量的交付与运行。
阶段可迭代、测试与设计可提前并行；不是八个串行大项目，也不另建八张管理表。
继续沿用产品 M1–M4/S0–S14、G1–G5、既有研发/Bug记录、Owner及已授权范围。

| 阶段 | 主责 / 协作 | 输入与实际工作 | 退出条件 / 证据 |
| --- | --- | --- | --- |
| Plan 计划 | IRIS；SABLE、CIPHER、NOVA、ECHO；商业取舍归Foundation | 用户问题、已有能力、范围与依赖；业务规则/UI/UX状态及异常；适用的定价、成本假设与风险 | 一个可验收结果、一个Owner、验收人、正常/失败/恢复条件；设计版本和未决事项明确，满足Ready |
| Code 编码 | 指定实现Owner：SABLE/CIPHER/LUQI/FLUX | 在权威工作区实现；设计、协议、SDK与调用方按实际依赖联动；代码评审 | 精确变更与审查证据，相关回归通过；对应G1，Implemented不等于Released |
| Build 构建 | 实现Owner + HARBOR | 可复现依赖、工具版本、配置与跨仓产物 | 构建日志、源码/制品哈希、目标网络和配置清单；跨仓一致性对应G2；无构建需求须说明N/A |
| Test 测试 | SENTINEL；IRIS验收用户结果 | 正常、异常、恢复、安全和受影响回归；UI/UX、权限、报价及所有权等按变更覆盖 | 结果、环境、候选身份及未测项明确；G1/G2和适用G3检查；失败回原卡，不能以测试数量替代旅程 |
| Release 发布准备 | Labs交付负责人；SENTINEL + HARBOR | 审核准确候选、范围、残余风险、权限费用和恢复计划 | 适用G3通过；唯一发布清单、放行责任与已有授权明确。定价变更须有已确认规则及用户告知方案 |
| Deploy 部署 | 已获授权的发布执行者；HARBOR支持 | 同一候选部署到准确目标；核对两站/网络/包/对象与初始化读回 | G4真实读回、部署身份和冒烟证据；原操作线上复验未完成则仍待验收，不自动扩大签名/付费权限 |
| Operate 运行维护 | HARBOR + ECHO；对应实现Owner | 支持、故障处置、依赖与成本管理、恢复演练 | G5适用检查、运行责任人、故障响应与恢复证据；成功交易先查询再恢复，前端回退不代表链上撤销 |
| Monitor 监控与反馈 | HARBOR技术指标；IRIS/NOVA/ECHO用户结果 | 任务成功率、失败原因、恢复耗时、成本和真实采用；内部/外部及模拟/生产分开 | 观测窗口、数据来源、阈值/未知项、发现与对应DEV/BUG编号；反馈进入下一轮Plan，有据才调整优先级 |

### 任务记录与状态

- 复用现有Delivery、DEV和BUG记录；追加“DevOps 阶段”和“阶段证据／退出条件”。其余负责人、优先级、依赖与验收字段沿用。
- 阶段表示当前工作位置，状态表示待办/进行/受阻/待验收等，两者独立。阶段变化不自动把任务标Done。
- “阶段证据／退出条件”按 `日期 | 阶段 | source/build/environment | 证据链接 | 通过/失败/待核验/N/A及理由 | 下一步/责任人` 追加；详细证据留源码仓库或原验收卡。
- 历史记录未逐项重验前，新阶段字段为空表示“未核验”，不默认Plan、Monitor或已完成；Owner在下一次实际推进/复核该卡时据实填写。
- Bug保留发现环境、原操作和原DEV/验收卡：分诊→修复→构建/回归→候选→部署→原操作复验。线上缺陷未复验不得关闭；纯构建/测试缺陷在原失败环境验收，生产不适用须说明理由。
- 管理/研究/设计任务可只覆盖适用阶段，但要明确N/A原因。设计稿完成不代表实现、上线或产品已验收；长期Operate/Monitor由运行责任承接，不要求单张开发卡永久不关闭。
- 任务完成范围须明确：Implemented、Verified、Released、Adopted分别有证据。产品卡关闭遵守原用户结果与里程碑验收，不因本协议降低门槛。

### 跨阶段控制

- 风险以影响、发生可能性、可检测性及恢复难度描述；沿用已有严重度/优先级，不强制启用未经校准的R0–R3编号。
- 所有权、权限、签名、费用、持久数据、合约/发布目标变化需在Plan识别，Code评审，Test验证，Release核对剩余风险与恢复边界；高风险改动必须独立复核。
- 安全、设计和质量贯穿循环。低影响文案/视觉改动采用相关检查，不机械执行无关全量测试；完整发布仍保留全部适用门禁。
- 定价/商业策略归Plan，收费实现归Code/Test，版本告知归Release，真实收入/成本与用户反馈归Operate/Monitor。此规则不自动决定价格或承诺收入。
- 原AC/SO Sprint节奏与生态评审节奏保留。每日异步更新真实推进和阻塞；Sprint Review演示用户结果；回顾最多选三个有验证方式的改进。
- 这次同步完成的是流程、模板和管理字段。CI、告警、调度、自动部署只有真实运行验证后才能标为已启用；协议不授予额外部署、签名、付费或外发权限。

### 工作项执行摘要（写在原卡，不另开表）

`DEV/BUG/任务ID；M/S；用户结果；Owner/验收人；当前阶段+状态；设计/业务版本；风险及控制；候选/环境；证据；剩余退出条件；下一步；上线后的观测责任。`
'''
append(root/'agent-management/OPERATING_MODEL.md',section)
append(root/'agent-management/EXECUTION_POLICY.md','''## 敏捷与八阶段执行（2026-10-05）

执行[统一协议](OPERATING_MODEL.md#8-敏捷--devops-八阶段统一执行协议2026-10-05-用户确认)：Plan → Code → Build → Test → Release → Deploy → Operate → Monitor → Plan。
每次有界任务输入/输出均记录阶段、原卡ID、实际证据及退出条件；任务状态和阶段分开。
设计/商业/风险进入原计划，Bug回流原卡，运行与监控结果进入下一轮计划。历史行不凭状态猜阶段。
本规则只同步执行口径，现有在途Owner、Sprint、门禁和权限不变；实际源码与生产推进依原授权。
''')
append(root/'agent-management/README.md','''## 敏捷 + DevOps 主流程（2026-10-05 已确认）

Plan → Code → Build → Test → Release → Deploy → Operate → Monitor → Plan。
[统一执行协议、八阶段责任与退出条件](OPERATING_MODEL.md#8-敏捷--devops-八阶段统一执行协议2026-10-05-用户确认)适用于全部岗位和产品环节；沿用现有研发、Bug和Delivery表，阶段与任务状态分开。
历史快照不作为当前执行状态；最新修复授权与进度查实际工作区CURRENT和原任务记录。
''')
# Correct the demonstrably stale current-state claim without changing bug records.
p=root/'agent-management/README.md'; s=p.read_text(); s=s.replace('39项，24历史关闭／15开放，全部待用户评审。当前停止修复与发布，初建12项快照已被本次清单取代。','39项清单及后续评审决定；用户已批准修复／复验，实时进度以原记录与CURRENT为准。初建12项快照已被该清单取代。');p.write_text(s)
append(root/'agent-management/shared/context-sync.md','''## 2026-10-05 已确认的交付方法

统一采用敏捷 + DevOps八阶段；完整规则见[运行协议](../OPERATING_MODEL.md#8-敏捷--devops-八阶段统一执行协议2026-10-05-用户确认)。Plan覆盖设计、商业假设和风险，Monitor回流原需求/Bug；不增设八套表，不重排现有Sprint，不把管理同步当作产品交付。
''')
append(root/'agent-management/shared/decision-log.md','''## 2026-10-05：敏捷 + DevOps 八阶段贯穿项目

用户确认采用Plan/Code/Build/Test/Release/Deploy/Operate/Monitor作为唯一交付主循环，敏捷管理增量与反馈。决定将责任、退出条件、风险、设计、商业及Bug回流接入现有记录。权威规则：../OPERATING_MODEL.md 第8节。原先八类管理视图及R0–R3只是讨论建议，不作为必须新增的制度。
''')
roles={'IRIS':'Plan与Monitor衔接；维护用户结果、优先级、设计/业务验收及反馈回流。','CIPHER':'Plan技术风险、Code协议与SDK评审、Test安全边界、Release准确目标复核。','SABLE':'Plan交互规格与状态、Code客户端实现、Test视觉/交互与恢复验收。','LUQI':'Code去中心化接入、Build配置一致性、Test权限/查询/冷恢复、Operate依赖故障。','FLUX':'Code跨产品联动、Test完整用户旅程、Deploy后同一资产身份与结果复验。','SENTINEL':'Test独立验证、Release质量证据复核、Deploy后原操作复验、Monitor缺陷回流。','HARBOR':'Build/Release/Deploy/Operate/Monitor支撑；记录准确制品、环境、恢复与观测证据。','NOVA':'Plan用户与定价假设支持、Monitor外部采用与成本结果；商业决策归Foundation。','ECHO':'Operate支持与故障分流、Monitor可复现反馈，关联原DEV/BUG后回Plan。'}
for name,scope in roles.items():
 append(root/f'agent-management/roles/{name}.md',f'''## 敏捷 + DevOps 环节责任（2026-10-05）

{scope}
遵循[统一八阶段协议](../OPERATING_MODEL.md#8-敏捷--devops-八阶段统一执行协议2026-10-05-用户确认)。每次交接附原任务ID、阶段、状态、候选/环境、实际证据、未满足退出条件和下一步；职责分配不扩大工具或签名权限。
''')
append(root/'agent-management/templates/creator-run.md','''## Delivery feedback linkage

- Linked DEV / BUG / Sprint acceptance card:
- DevOps stage observed: Plan / Code / Build / Test / Release / Deploy / Operate / Monitor
- Stage evidence and remaining exit criteria (N/A must explain):
- User result / business or pricing hypothesis tested (if applicable):
- Feedback owner and next Plan action:
''')
append(root/'docs/codex/PROJECT_MEMORY.md','''## Confirmed delivery loop (2026-10-05)

- User confirmed Agile + DevOps Plan/Code/Build/Test/Release/Deploy/Operate/Monitor across product, design, engineering, release and operations. Canonical stage responsibilities/exit criteria: `agent-management/OPERATING_MODEL.md` section 8.
- Reuse existing Delivery/DEV/BUG records; lifecycle stage is independent of task status. Design, pricing and risk belong inside the loop. No eight new boards or uncalibrated mandatory R0–R3 scale. Existing M1–M4/S0–S14/G1–G5 and active implementation ownership remain authoritative.
''')
append(root/'AGENTS.md','''## Confirmed Agile + DevOps loop

Use `agent-management/OPERATING_MODEL.md` section 8 for Plan → Code → Build → Test → Release → Deploy → Operate → Monitor. Reuse the existing task and bug records; record stage, evidence and exit criteria separately from status. Preserve current product roadmap, active owners and authorization boundaries. Process documentation is not evidence of deployed automation or completed product behavior.
''')
append(ac/'docs/codex/AGILE_DELIVERY_PLAN.md','''## 2026-10-05：统一八阶段口径（用户确认）

敏捷 + Plan → Code → Build → Test → Release → Deploy → Operate → Monitor → Plan。
完整跨岗位规则：[项目运行协议](../../../../agent-management/OPERATING_MODEL.md#8-敏捷--devops-八阶段统一执行协议2026-10-05-用户确认)。
Plan涵盖需求/设计/业务与定价假设/风险；Code对G1，Build对G2，Test对适用G1–G3，Release对G3，Deploy对G4，Operate/Monitor对G5并回流原DEV/BUG。门禁按变更适用范围执行，完整发布不减项。
原M1–M4/S0–S14、当前Owner和证据保持；每张原卡追加阶段、候选/环境、证据和退出条件，任务状态独立。文案/研究任务不适用环节须解释；未知历史阶段不猜测。原网站缺陷仍须原操作复验，流水线与告警未运行不记已启用。
研发/Bug频道已在项目workspace.json登记；通知自动化仍未配置，消息发送依已有明确授权。
''')
append(so/'docs/plans/2026-09-05-composable-soul-integration.md','''## Confirmed delivery process — 2026-10-05

Use Agile + Plan → Code → Build → Test → Release → Deploy → Operate → Monitor → Plan.
The authoritative AC `docs/codex/AGILE_DELIVERY_PLAN.md` maps stages to the existing G1–G5 gates; the management root `agent-management/OPERATING_MODEL.md` section 8 defines shared owners, exit criteria, design/business/risk inputs and feedback. Follow the latest AC CURRENT for actual priority, not historical checkpoints above.
Keep the original M1–M4/S0–S14 and linked DEV/BUG identities. Record stage separately from status, attach exact candidate/environment evidence, and verify original deployed operations before closing production bugs. No new deployment/signing authority or claim of automated monitoring follows from this process update.
''')
for p in [ac/'.github/ISSUE_TEMPLATE/bug_report.md',ac/'.github/pull_request_template.md']:
 append(p,'''## DevOps stage and handoff

- Current stage: Plan / Code / Build / Test / Release / Deploy / Operate / Monitor
- Stage evidence / remaining exit criteria (N/A with reason):
- Applicable G1–G5 gates and exact candidate/environment:
- Design/business/pricing rule version affected (or none):
- Operational observation owner, signal and feedback DEV/BUG:

Stage is independent of task status. Risk/security review spans all applicable stages; documentation does not prove a pipeline, alert or deployed user result.
''')
(root/'work/devops-sync/changed-paths.json').write_text(json.dumps(changed,indent=2))
print(f'Updated {len(changed)} existing policy, role, template and delivery entry files.')
