# M0：仓库与协作工具基线

历史核验快照：2026-10-03管理搭建前。本文件保留当时读数；现行状态已更新到 [LIVE_PRODUCT_STATE.md](LIVE_PRODUCT_STATE.md)，Slack和岗位现已落地。本文的未连接/未创建等表述仅适用于快照时点。

## 必须先修正的版本判断

前一轮按当前本地目录得出的 Animacraft v5 状态仅适用于该旧分支。GitHub main 已是 Fresh Maker v8；其版本固定的 CURRENT 记录七包主网发布、生产配置与 Vercel 切换完成。不能继续将旧 v5 的两个 B0 问题直接当成当前生产阻塞，也不能重新实施已由 v8 替代的路径。

本轮读取的是远程版本和历史发布证据，不是新的浏览器、链上或生产验收。Animacraft CURRENT 中 protectedDecryptionReady=false 是该发布记录的边界；是否被后续配置变更解决需要进一步核对，不能仅由旧发布段落断言今天状态。

- [Animacraft v8 源码说明](https://github.com/redefine-digital-labs/animacraft/blob/592699af0eb8bd5cd0015b0898fbb45f2cbdef0e/README.md)
- [Animacraft 主网发布记录](https://github.com/redefine-digital-labs/animacraft/blob/592699af0eb8bd5cd0015b0898fbb45f2cbdef0e/docs/codex/CURRENT.md)
- [Soulidity 主网部署清单](https://github.com/redefine-digital-labs/soulidity/blob/3a1f223ef3f88fef529d08e44183697595d714ef/packages/soulidity-sdk/src/deployment-manifest.json)

## 工具与访问

| 系统 | 已核验事实 | 未核验/未执行 |
| --- | --- | --- |
| Slack | 插件连接且读取成功；当前档案 hixiaopai，Sega；已有公开频道 #crypto-openclaw-soulidity，ID C0AJCKH65BQ | 未创建频道、发送消息、修改成员或启用通知；未搜索私聊/私有消息 |
| GitHub | 当前连接身份 soul893；API 返回七个产品仓库的 admin、push、pull 权限 | 权限不等于各 Agent 独立身份，也不等于生产/链上授权；没有写入 |
| Linear | 上轮发现可用插件；本轮无连接确认；方案已改为后续可选 | 不作为 M0 前置依赖 |

频道名搜索 soulidity 命中上述频道；animacraft 未命中独立频道；仅该频道内 linear 关键词检索无结果。这不证明组织没有其他看板或工作区。读取最近 12 条频道消息，可见产品交流；未按消息推定当前人员任命。

建议先复用现有频道，待工作区及沟通安排明确后再规划工程/发布/支持分流。Slack 连接不会自动启动机器人或定时通知。

## 七个产品代码仓库的远程快照

下表是 GitHub API 的同日即时读取。protected 字段只反映该次 branch API 响应，不代表已完整审计组织 ruleset。无 workflow/run 返回不代表没有外部 CI。

| 仓库 | 默认分支 / HEAD | protected | GitHub Actions 证据 | 下一步 |
| --- | --- | --- | --- | --- |
| soulidity（含协议/App/desktop） | master / 3a1f223ef3f8 | false | 当前主线 PR checks 成功；有 Desktop Release workflow | 核对实际开发工作区、SDK/ABI/生产版本；检查桌面发行 |
| animacraft | main / 592699af0eb8 | true | 当前主线 Repository hygiene 成功 | v8 + 在途 PR + 生产配置对齐，验证创作者旅程 |
| infinite-flow-engine | main / 8399544b0f48 | false | API 无 workflow 和近期 run | 在现有发布门槛上补自动检查方案 |
| soul-expedition | main / 39e54642bd06 | false | API 无 workflow 和近期 run | 固定引擎版本，核对部署并补旅程检查 |
| soul-paper-theater | main / 2daebef1f74d | false | API 无 workflow 和近期 run | 同上；作为第二模板复用验收 |
| infinite-stellar | main / 75fe712e4d23 | false | 仅返回动态 Dependabot workflow；最近三次失败 | 区分依赖更新失败与产品测试；对齐未合入开发分支和部署 |
| soul-habitat | main / 53b249fb0fc8 | false | Documentation 成功 | 按模拟 MVP 范围启动可执行切片 |

成功证据：[Soulidity 主线检查](https://github.com/redefine-digital-labs/soulidity/actions/runs/37116966506)、[Animacraft 主线检查](https://github.com/redefine-digital-labs/animacraft/actions/runs/37120964860)、[Habitat 文档检查](https://github.com/redefine-digital-labs/soul-habitat/actions/runs/31285702029)。失败证据：[Stellar 依赖更新](https://github.com/redefine-digital-labs/infinite-stellar/actions/runs/36326869257)。这些不替代生产端到端验收。

## 在途工作不能被新计划覆盖

远程读取时已存在：

- [Soulidity #32](https://github.com/redefine-digital-labs/soulidity/pull/32) / [Animacraft #59](https://github.com/redefine-digital-labs/animacraft/pull/59)：跨产品 native PNG geometry；读取时两边 CI 仍进行中，不预判结果。
- [Soulidity #31](https://github.com/redefine-digital-labs/soulidity/pull/31)：light-theme contrast。
- [Soulidity #30](https://github.com/redefine-digital-labs/soulidity/pull/30)：Physical v7 wardrobe。
- [Animacraft #53](https://github.com/redefine-digital-labs/animacraft/pull/53)：Expansion Pack v8 与创作者编辑。

这里只纳入管理清单，没有开始审查、合并或修改这些 PR。首轮 backlog 应先明确这些工作与 M1/M2 的关系和当前执行者，再开新实现任务。

## 本地版本与远程版本的关系

原始 Git 快照见 [13 个位置的只读证据](evidence/2026-10-03-local-repositories.json)。

- Soulidity 当前管理目录仍在 codex/maker-editor-p0 / 40dc2ce5ee56，与远程 master 不同。clawnews/ 在此处不是独立 Git 根；其本地目录结构与远程代码根不同。禁止直接把远程根的代码路径机械套到该管理目录。
- Animacraft 当前目录在 codex/commerce-rights-v5 / 99c6b2b9b6ea，有 7 个未提交文件；保留为旧分支工作。远程 main 已到 592699af0eb8。
- Git 注册了 Soulidity 11 个和 Animacraft 52 个 worktree 条目，包括标为 prunable 的条目；这不是活跃任务数。尚未逐一认定权威开发路径、使用者或清理资格，未删除/归档任何内容。
- Infinite Stellar 本地 codex/dark-forest-parity / e4f6d325c98d 有 25 个状态条目，远程 main 为 75fe712e4d23。本地 CURRENT 的九月开发进展比远程 CURRENT 的八月 canary 记录深入；不能用远程 main 覆盖本地工作，也不能默认本地改动已上线。
- Engine、Expedition、Paper Theater、Habitat 的所查本地 HEAD 与远程默认分支一致，工作区干净；不由此推断生产发布。
- 另有 soulidity-docs、soulidity-ideas、onchain-experience-network、Maker Launch Playbook、OC Autonomous Worlds Roadmap 等资料仓库。最后两个位于 soul893 个人命名空间，不混为组织产品代码仓库；后续核对其角色与权限。

## 下一步的实际执行责任

角色 Agent 尚未实例化；以下是当前可执行责任，不虚报多个 Agent 已工作。

| 工作 | 当前执行责任 | 候选后续岗位 | 退出条件 |
| --- | --- | --- | --- |
| 对齐权威实现工作区、在途 PR、运行版本 | Labs CEO / Codex | IRIS、CIPHER | 每个产品有明确源码/部署基线和待验收增量 |
| 主任务系统接入、字段和权限验证 | Labs CEO / Codex；账号连接由持有人完成 | IRIS、HARBOR | 有一个可访问的主看板及任务记录，无重复状态源 |
| 岗位合同和独立验收路径 | Labs CEO / Codex | IRIS、SENTINEL | 角色、工具身份、可写范围和验收责任明确 |
| Foundation 当前人员、预算和外部试点资源 | Naoer | NOVA、ECHO | 资源边界与责任人记录，历史任命不自动沿用 |

M0 未完成项：权威工作区/真实部署核验、任务主系统接入、岗位启用、真实任务演练。后续再进入 M1 现行 v8 用户旅程验收，不返回旧 v5 路径重做产品。

## 工具方案修订

用户提出 Slack 自带项目管理能力后，Labs 将起步建议简化为 Slack Lists + GitHub。Lists 工具读写能力已发现，但工作区套餐、Lists 开关及实际创建权限未验证；未创建或分享 List。后续优先验证现有 Slack 条件，Linear 保留为复杂规划需要时的选项。
