# 敏捷、DevOps与发布流程

沿OPERATING_MODEL §8及手册v1.0 §§1–4/5/7/8.3/8.4/9/10/11/12；状态与阶段分开。既有负责人、产品里程碑和原Bug记录不变。

## Sprint合同

一轮优先一个用户结果。Ready：准确需求/权利/收费、输入输出/失败恢复、Owner/依赖、候选环境和验收明确。故事关联F/C/E/A/J及R/D，不建第二开发看板。每日更新当前阶段、实际证据、阻碍和下一步；Review演示可操作用户结果；回顾形成少量可验证改进。未估算前不承诺日期。

Done范围必须明确：源码实现、已测试、已发布、已部署、已采用分别证据。准备文档与现前端映射仅Done文档范围。R1–R7未开始；用户开工确认前不写生产代码。

## 八阶段及证据

| 阶段 | 必要输入/产物 | 退出条件 |
| --- | --- | --- |
| Plan | 当前规则、UX、接口、威胁/资金/视觉、fixture、验收 | G0确认；相应故事Ready |
| Code | 隔离worktree、准确源码/依赖锁、方案映射 | peer review及接口/不变量实现证据 |
| Build | 固定工具链、Move/framework/SDK/render依赖、双站制品hash | 可重复构建及完整candidate manifest |
| Test | 相关Move/SDK/视觉/资金/权限/原旅程、Bug | 对应门禁实测通过；差异已处理 |
| Release | 准确commit/包bytecode/SDK/AC/SO组合、审查报告、权限和预算 | 审计覆盖/候选差异/回滚退出明确 |
| Deploy | 目标网络、付费/签名授权、发布与初始化顺序 | digest+package/object/Cap/配置读回 |
| Operate | 原旅程冒烟、support/对账/依赖续期、事故手册 | 实际Owner接管和资金/内容检查 |
| Monitor | 数据源/窗口/阈值/响应者、告警演练 | 真告警/恢复及运行报告，不是“配置存在” |

## 候选与CI/CD设计

以SO隔离基线0cfb60a29b2b378dd9fbf31970b324b2ef2e301e和AC行为来源65b4218012b54c37966a5ad88e803a9d66185ff4为输入；未来源commit与dirty范围要重新记。Move test/build、各包实际package scripts、frontend build、schema/BCS集成和需要的视觉测试按准确仓结构执行，记录完整命令/exitcode/制品hash。现在不伪造CI已连接、testnet部署或监控自动化。

testnet验证使用隔离身份与预算，mainnet候选固定同一组合配置。选框架/RPC/Walrus/Seal/SDK版本、保存期限和网络对象ID，不能用latest作为发布身份。SBOM从实际lock/制品产生，安全依赖检查与构建供应链审查附release。

## 发布与切换步骤

1. 固定源码/依赖/制品并审查版本；确认所有所需门禁与资金/签名授权。
2. 准备network/package/module/ABI配置与新发布路径，不覆盖旧资产/旧Owner的CURRENT。
3. 发布新包；按实际依赖初始化对象、Cap/产品/收费配置；逐项读回真实Owner和数值。
4. SDK＋AC＋SO引用同候选配置；校验域名/制品hash和交易payload，避免一站新一站旧。
5. 隔离身份跑适用37步/上线冒烟，核付款收款/发行/装卸/权限/市场；失败不宣称上线成功。
6. 在明确切换授权下正式入口启用；保留旧访问/说明及故障路径；运行监控和对账。

前端回退不撤销已部署包或已成交资产；链上失败必须按具体修复/新部署/授权退出方案处理。新包init与升级行为不可混淆；升级旧包是否满足policy另行验证。

2026-10-07范围复核：UI权威是现网站；禁止以另做HTML/Penpot交互改变页面结构或操作路径。按02_UIUX_CN.md逐页映射并回归原旅程；当前仍Plan，等待用户明确开工。
