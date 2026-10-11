# 威胁模型、权限及治理准备

设计状态，所有新生产检查Not run。沿原合约安全C01–C15与风险A01–A11，内部QA、独立复核、外部审计分别记录覆盖候选。

## 必须证明的不变量

I01 每Part至多一件固定Style；多片不增容量。I02 只有Creator声明TRANSFERABLE才生成自由Item。I03 Bound无钱包/跨Soul/独售出口，卸下不从整套范围移除。I04 Free attach custody与binding原子，detach原ID且无双重持有。I05 来源/发行授权/许可/Adapter不可伪造。I06 已发行权利不可被新产品Owner静默改写。I07 清单对应root/revision/hash及全部Bound/已装Free。I08 支付/分账/清Grant/交接全成或全无。I09 attempt防跨交易重复发行/扣费。I10 越权UID/Cap/模块删除/类型混淆不能破坏根。I11 内容hash/Seal策略与真实Owner/容器匹配。I12 重试、取消、超时和并发保持资产与资金守恒。

攻击面：伪造Maker/Pack发行证明、复制Style引用冒充资产、假Bound自由对象、slot/版本竞态、恶意Adapter/素材、旧报价/并发供给、支付CoinType/精度、未知交易重放、伪装容器Owner、委托过期/撤销、Cap漏转/升级绕过、供应链/域名/RPC/内容和索引故障。

## 私密授权的未决边界

owner-only每次核验当前真实持有和支持的容器路径。标准市场成交强制原子清全部旧Grant；买家重新授权。Grant至少scope、grantee、issuer、expiry、revoke状态，并拒绝当前Owner不等于issuer的旧委托。

key+store允许外部public_transfer，无法自动运行自定义清理。仅issuer校验可阻止新Owner期间使用旧委托，却不能保证转回旧Owner时永不复活。必须在A记录作产品决定：A) v1自由可转，额外委托限定受支持交接路径并明确其他路径限制；B) 私密委托能力采用所有交接可控制的profile并验证每个容器/市场路径。未决定及验证前，不上线宣称“任意转让必永久清委托”的能力。已经解密的明文不能远程收回。

## 权限登记与控制

设计登记模板列：网络/包/对象/Cap、入口、实际Owner、产品范围、最大影响、管理成员/门槛、升级约束、timelock、pause、资产锁、撤销/恢复/退出、读回与监控。实际Owner及ID留空且状态“待部署读回”；不能把角色岗位名当已创建多签。

产品控制资产、发行Cap、Fee/Treasury、UpgradeCap、紧急Pause、内容续期/Seal策略、前端发布权分开梳理。审核所有直接/间接路径，包括UpgradeCap重新扩权、Cap转移/共享、调用其他包的wrapper、旧包版本继续可调用。

多签≠时间锁≠升级policy≠永久immutable≠资产锁≠pause。候选逐包选择compatibility/additive/dependency-only等具体政策并核对应framework；永久撤销升级能力是不可逆动作，不能在准备阶段执行。Pause应精确列受影响操作与用户取出/取消/退出能否继续。

## 审查及审计包

提供准确commit、包/依赖lock与bytecode摘要、布局/入口/Cap/状态、资金流、invariants、测试/负例、异常与退出、已知风险和变更范围。独立审查记录实际人/范围/候选/结论；高风险发现需修复或正式记录允许的有限范围，不用“接受风险”冒充修复。审计后每个diff重新判断影响；任何“审计通过”须可读报告和准确覆盖版本。

依据：[Sui生产准备](https://docs.sui.io/develop/production-readiness)、[Sui升级](https://docs.sui.io/develop/publish-upgrade-packages/upgrade)。
