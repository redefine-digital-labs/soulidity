# Soulidity 生态交付里程碑

日期：2026-10-03。方向已确认，范围、数值与时间窗口为 Labs 规划提案。用户已授权落地。Slack两张List与Hub已创建，岗位合同已登记并有实际执行记录；ECO-0仍在进行，ECO-1–ECO-6未验收。旧融资/TGE 时间目标见 [4 月记录](history/2026-04-13/milestones.md)，不作为当前承诺。

同日远程核验修正：ECO-0 已取得部分证据，详见 [ECO-0 基线](M0_BASELINE.md)。Animacraft 主线为 Fresh Maker v8，已有主网发布记录；旧 v5 工作区的 B0 不能直接列为当前生产阻塞。所有执行任务先对齐当前主线、在途 PR 和部署版本。

## 共同目标

让外部 AI Agent 创作者持续创造角色、内容和游戏体验，使用 Soulidity 身份与权限，在运行端和游戏使用作品，再继续创作。内部 Agent 组织承担建设、交付与支持。

## 里程碑

| 阶段 | 可演示结果 | 拟交付 Owner / 最终负责人 | 验收门槛与依赖 |
| --- | --- | --- | --- |
| ECO-0 组织与交付基线 | 仓库、版本、未完成改动、负责人、依赖、主看板和岗位登记 | IRIS / Labs CEO；HARBOR支持，Foundation核对人员资源 | 每个产品有唯一交付负责人、阶段、下一验收；工具身份/权限核验；演练真实低风险任务的需求→实现→独立验收→记录 |
| ECO-1 承接现行产品交付与可靠旅程 | Animacraft 一个真实 Maker → 角色 → 验证授权与 Soul 铸造 → SoulDesk 或一个已具备条件的运行端读取 | FLUX（集成 Owner），SABLE/CIPHER/LUQI 支持 / Labs CEO | 依赖 ECO-0；承接既有AC-SO-M1–M4与S13，不缩减原范围；对齐主线、在途PR与新部署；实际发布、授权、铸造、读取证据及失败/重试/恢复测试；明确网络，分别验收 |
| ECO-2 创作者 Agent alpha | 角色、场景/玩法、叙事三种内部试用实例；身份、工具、作品和反馈记录 | IRIS / Labs CEO；FLUX支持，NOVA准备入门 | 依赖 ECO-1；建议至少 3 个实例各完成两轮已支持任务，记录人工介入、成本与二次作品；场景发布等 ECO-3；不计为外部采用 |
| ECO-3 首个可创作游戏体验 | 固定版本的 Infinite Flow Engine + Expedition 首选模板 + 最小受限 Scene Maker；Paper Theater 验证模板复用 | FLUX / Labs CEO；CIPHER/SABLE支持 | 创作者改允许的内容/参数→校验→发布版本→Soul 入场→链上结果凭证；第二模板验证复用；引擎/游戏发布门槛通过；依赖 ECO-1 |
| ECO-4 全产品可验收切片 | SoulDesk 品牌/读取闭环；Stellar 到达结算与特殊动作等独立增量；Habitat 的 30 游戏日可回放模拟 | IRIS 统筹，各切片独立 Owner / Labs CEO | 按容量与 ECO-2/ECO-3 滚动并行；逐产品独立验收；Stellar 保留主网证明/审计/运维门槛，Habitat 使用不可提现 Life Credits；不宣称全部上线 |
| ECO-5 外部创作者封闭 beta | 独立操作者的 Agent 使用已验收旅程；反馈、支持和服务指标运行 | NOVA / Foundation；ECHO和HARBOR支持 | 依赖 ECO-2/ECO-3 对应能力；建议 3–5 位外部操作者、至少 5 个 Agent，至少 3 个 Agent 在第二周再次创作；核验作品；完成一轮外部反馈驱动改进 |
| ECO-6 可持续发布与扩张 | 稳定发布和支持、标准接入文档/SDK、可复用合作案例与资源模型 | Labs CEO + Foundation，按工程/业务分别负责 | 依赖 ECO-5；连续至少两个周期兑现目标；基于 beta 基线达到双方设定 SLO；恢复演练通过；复核留存/成本后决定公开范围和扩张 |

ECO-1–ECO-3 是主路径。ECO-4 各产品独立推进，不构成首批 beta 的统一前置条件。ECO-5 只开放验收通过的能力。主网部署不设未经技术核实的日期。外部试点数量是提议退出标准，不代表市场匹配。

## 首个两周周期候选 backlog

PLAN任务已进入Slack Delivery；状态与当前执行Owner以Slack为准。下表是需求摘要，不是第二套手工看板。没有创建重复GitHub issue。

| ID | 任务 | 拟 Owner | 验收 |
| --- | --- | --- | --- |
| PLAN-001 | 核对全产品仓库、工作区、远程和运行版本 | IRIS | 产品清单逐项有证据和下一步，保留未完成工作 |
| PLAN-002 | 配置主看板、字段、身份和权限，演练一项任务 | HARBOR | 真实任务与证据关联；接入后才算完成 |
| PLAN-003 | 更新岗位合同和旧提示词，按需启用 PM/实施/QA/DevOps | IRIS | 职责、工具、可写范围、验收者和停用方式齐全 |
| PLAN-004 | 对齐 Animacraft v8 主线、生产配置、在途 PR 与旧 v5 改动 | CIPHER；SENTINEL 独立验收 | 明确当前真实缺口，保护旧改动，不把历史 B0 自动带入生产计划 |
| PLAN-005 | 核对 Animacraft→Soulidity 接口、版本和授权 | FLUX | 版本矩阵及可执行验收步骤 |
| PLAN-006A / PLAN-006B | 第一名角色创作者 Agent 的任务与作品记录 | SABLE | 明确环境中的实际编辑/导出，记录介入与问题 |
| PLAN-007 | 盘点 CI、环境、发布、监测与恢复 | HARBOR | 区分真实运行、仅文件存在和缺失，排序主旅程缺口 |
| PLAN-008 | 外部用户画像和试点资源边界 | NOVA / Foundation | 招募标准、预算和支持方式；本轮不发送招募消息 |

## 时间与资源

两周一次交付评审。首周期重点 ECO-0 与 ECO-1 阻塞收敛；第二至第三周期暂排 ECO-1/ECO-2；ECO-3–ECO-6 在首周期后按容量和依赖定日期。文档完整度不代表工程工期。

默认一条主要集成工作流和一条平台工作流；全产品纳入管理，不要求同时开发。Foundation 明确资源优先级，Labs 提出容量和交付承诺。

## 继承的实际工作

- Animacraft 嵌套仓库旧 v5 分支有 7 个文件的未提交改动，均保留；它不是最新主线。实时核验的 main 为 592699af0eb8，README 描述 Fresh Maker v8，发布记录描述七包主网发布。链上实时状态未重新验证。
- Infinite Stellar 已交付 home/fleet 增量的记录保留，arrival settlement 等工作未发布，主网未部署。
- 引擎与游戏已有代码和本地教学，按既有基础排期；不把代码存在等同生产交付。
- [旧总入口快照](history/CURRENT-before-2026-10-03.md)保留原 Animacraft 目标。总协调入口更新不代表产品目标完成。
- 本轮创建Slack管理对象和按任务Agent会话；未提交、推送、开PR、部署、签名或发消息，未创建无人值守常驻Agent。

## 依据

- [运行规则](OPERATING_MODEL.md)
- [产品地图](../docs/SOULIDITY_ECOSYSTEM_CN.md)
- [Animacraft](../animacraft/README.md)
- [Infinite Stellar](../../infinite-stellar/docs/codex/CURRENT.md)
- [Soul Habitat](../../soul-habitat/README.md)

## 既有产品路线图映射

ECO编号仅用于生态层，不能与原产品M1–M4混用。原范围、Sprint节奏和已授权执行继续有效，当前事实见 [LIVE_PRODUCT_STATE.md](LIVE_PRODUCT_STATE.md)。AC-SO-M1创作者保真、AC-SO-M2三个模块用户端、AC-SO-M3身份/装备/市场、AC-SO-M4统一发布及完整验收，全部仍未整体验收。当前是S13实站验收，不是从ECO-1重新实现原产品。
