# Soulidity 当前产品与交付事实

核验：2026-10-03，约12:50 UTC。管理层快照，不是替代产品路线图。活跃执行会继续变化；下次从指定CURRENT读取，而不是依赖本文数字。

## 唯一产品执行来源

- 活跃chat：**Unified Maker v8 Market execution**，ID `01a02161-12b8-7b83-9d6e-2da4e7027107`，本次只读核实为active。
- Animacraft实际执行目录：`/Users/naoer/Documents/Claude/Projects/soulidity/tmp/animacraft-v8-mainnet-release`。
- Soulidity实际执行目录：`/Users/naoer/.codex/worktrees/f722/soulidity`。
- [实际CURRENT](../tmp/animacraft-v8-mainnet-release/docs/codex/CURRENT.md)记录实时卡片。
- [既有产品路线图](../tmp/animacraft-v8-mainnet-release/docs/codex/PRODUCT_DELIVERY_MILESTONES.md)规定原M1–M4范围。
- [既有敏捷/DevOps计划](../tmp/animacraft-v8-mainnet-release/docs/codex/AGILE_DELIVERY_PLAN.md)分解S0–S14与门禁。

新Slack层把原产品里程碑标为AC-SO-M1至AC-SO-M4，生态层使用ECO-0至ECO-6。两个命名空间不互相替换。此管理任务不向活跃chat发指令、不修改其源码/控制文件、不重启其发布。

## 已确认且必须继承的产品约束

- Animacraft/Soulidity是chain + frontend架构，无自有业务后端/数据库/SSR服务依赖；Sui、Walrus、Seal访问继续存在。LUQI岗位相应调整为数据与去中心化接入，不新建业务服务器。
- 创作者独立用自己的钱包发布，不新增平台审批/代签；保留真实内容和存储证明。
- 当前以完整原产品和Fresh-v8为目标；原Creator/Player/Pack/Composable/Commerce能力保留，不能因新管理或接口调整缩减。
- 原产品用户曾确认全新部署初始化，不添加旧作品迁移/兼容发行目标；这不授权本管理任务发起链上交易。
- Soulidity承担持久装备、Loadouts、Showcase和市场；Player选择不是Soul持久装备。每Soul Part至多一件，卸下不自动还原；出售Soul不自动捆绑装备。
- 原执行者已有自己的发布授权和门禁，继续有效；本管理任务的设置授权不改变其权限或替它执行。

## 现行AC/SO状态（来自活跃CURRENT与工具证据）

| 层面 | 当前有证据的事实 | 仍未完成 |
| --- | --- | --- |
| 合约与双站发布 | CURRENT记录S12/G4完成，13次链上写入已最终读回，release ID `8dd402857b952c8a3e71ccb8ea56a032316109d92165265608c269625b2b60a7` | 不得重跑此发布；本任务未独立复查每笔交易 |
| 已上线前端 | 记录SO `dpl_6i4b5CeFS4DeuQqjzGzhFgknrVPQ`；AC随后修复导出偏好并晋升至 `dpl_NpjbaXKv88WkkKEkDR4VuL1AqDRs` | 此处是有来源的部署记录，不是本任务新的完整生产验收 |
| S13本地/公开验收增量 | 新建/保存/冷重开、原作品ZIP往返、导出偏好、尺寸/透明度等有逐项浏览器证据 | 全部钱包、protected decryption、桌面/移动端矩阵未关闭 |
| 当前S13-F01-B | 修复原PNG尺寸/中心定位；AC #59 `32a8df07`，SO #32已更新至 `82904f013c7f` | 读取时均open；修复配对CI和静态资源一致性仍在收口，不标上线 |
| 既有四里程碑 | M1创作者保真、M2三个模块用户端、M3身份/装备/市场、M4统一发布及完整验收 | 全部仍未整体验收；S14恢复/完整交接仍要求 |

SO旧候选CI37123133403失败后，同一执行者已修复两个测试文件并重跑37123860750；管理层不重复派人修同一问题。主线成功与候选失败属于不同revision，必须分开显示。

证据：[SO #32](https://github.com/redefine-digital-labs/soulidity/pull/32)、[AC #59](https://github.com/redefine-digital-labs/animacraft/pull/59)、[SO修复后运行](https://github.com/redefine-digital-labs/soulidity/actions/runs/37123860750)、[AC候选运行](https://github.com/redefine-digital-labs/animacraft/actions/runs/37123133805)。动态结果以对应API/执行CURRENT新读回为准。

## 其他产品

| 产品 | 已核验基础 | 下一项验收/未知 |
| --- | --- | --- |
| SoulDesk | 在Soulidity仓库desktop内；Desktop Release workflow存在，HARBOR读取返回0次运行 | 品牌/安装包与最新身份读取兼容仍待核验，不宣称新发行 |
| Infinite Flow Engine | main `8399544b0f48`；实验P0与Move/SDK检查命令，未查到Actions流水线 | 补现有检查自动化及真实部署/模板验收；原发布审计门槛保留 |
| Expedition / Paper Theater | main `39e54642bd06` / `2daebef1f74d`；客户端/Move/本地教学 | 当前链上部署与引擎固定版本待核；没有Actions不等于没有外部CI |
| Infinite Stellar | main `75fe712e4d23`；本地`e4f6d325c98d`及未提交增量；测试网canary和模拟记录 | 未主网部署；本地新增到达结算等不可当远程已发布；Dependabot失败不是产品测试失败 |
| Soul Habitat | main `53b249fb0fc8`，文档CI成功 | 规划态；首个30游戏日回放模拟尚未交付 |

## 管理与Agent实际状态

Slack工作区Sega的Milestones、Delivery与Hub已创建。完整合同：9个内部岗位、3个内部creator-alpha档案。IRIS完成任务拆解，HARBOR完成CI核验，MIRA完成一次公开入口发现；SENTINEL独立验收另记报告。

MIRA发现Creator Studio入口和本地编辑文档；浏览器已有钱包会话和草稿，未改变它们。不能据此断言匿名创作成功，也不能把UI显示0个公开Maker当作完整链上统计。未产生两轮创作作品，未形成外部采用。独立Agent账户、链上身份和无人值守运行均未配置。

## 本轮修正记录

- 将“全部停在v5、未开启主网”的宽泛判断修正为旧分支事实；使用现行v8/S12/S13证据。
- 发现已存在产品级敏捷/DevOps计划；生态管理承接它，不清零或替换原M1–M4。
- 不按历史七包发布固定当前依赖数量；当前联动CI含八包，按现行依赖图执行。
- 删除当前岗位入口中依赖旧CONTEXT、四月融资/TGE日期和旧Collection优先级的执行指令；原文保存在history。
- 区分源码、主线CI、候选CI、发布记录、浏览器观察、钱包验收和外部采用。
