# 对象、接口与状态设计合同

阶段：设计评审；函数名为业务命令草案，不是已部署ABI。生产Move布局/BCS/typeTag/事件签名在R1源码与测试后固定，并进入发布manifest。

## 对象与存储

| 形态 | 所有权/能力候选 | 内容与出口 |
| --- | --- | --- |
| Soul | owning root，key+store | 稳定身份/标准版本/必要模块；公共转移可用于钱包/容器；包内借UID操作组合 |
| Core / Composition / BoundParts / Authorization | Soul下标准DOF模块；由根模块控制入口 | UID不暴露给任意调用者；必要模块不能被用户任意删除；内部记录用DF/Table |
| Item | key+store，自由组件 | 来源版本、固定Style、权利证明、视觉表示；仅TRANSFERABLE；attach/detach原ID |
| BoundRecord | 模块内部值/Table记录 | 永久所属Soul，清active binding不删除记录；无wallet-export入口 |
| ReferenceSelection | Composition数据 | 内容hash/版本/许可/Style；不是持有源资产的证明 |
| Maker/Pack及其控制 | 独立产品控制资产＋发布版本/权利策略 | Owner转移不改玩家已发权利；使用资格单独记录 |
| Grant | Authorization内数据 | issuer、grantee、scope、expiry、revoke；不能只凭旧issuer读取新owner内容 |

DOF=Dynamic Object Field（动态对象字段）：子对象仍可被索引看见；`add/remove`要求真实object满足key+store且拥有根UID访问。DF=Dynamic Field，适合内部值。接收转到对象地址的Receiving<T>是另一条资产接收路径，不等同已装槽；本版标准attach显式接收用户可支配Item并原子DOF插入+slot binding。若支持外部向Soul地址直接转入，必须单独设计receive/reject/recovery，不默认把任意入账认作装备，不创建本版通用闲置自由库存。

## 最小业务命令

| 命令 | 必须输入/核验 | 原子结果 | 拒绝与读回 |
| --- | --- | --- | --- |
| create_soul/Complete | 准确Maker/Pack版本、固定Style选择、资格、发行授权、quote、attempt | Ref记录、Bound记录、可交易Item按政策发行并装配、准确root/recipe | 不合法来源/供给/付费/重复attempt拒绝；按attempt读回Soul和支付 |
| attach | 当前Soul控制、真实原Item、目标Part、source licence、Adapter、expectedRevision | 入DOF＋占槽＋revision/recipe更新 | 错Owner/非自由/不兼容/同槽占用/旧revision拒绝 |
| replace | 同上＋旧槽退出策略 | 原Free返钱包，Bound留记录，Ref清选择；新件装入 | 全部一笔或无变化，不能吞旧资产 |
| detach | 当前Owner、expectedRevision、已装Free ID | 移除DOF/binding；原对象原ID返Owner；更新revision | 非Free拒绝；不得跨Soul取他人资产 |
| unmount/remount_bound | 当前Owner、同Soul BoundRecord、目标Part、许可/适配 | 只更新显示绑定；记录仍留原Soul | 钱包导出/跨Soul拒绝 |
| clear_reference | 当前Owner、对应Part/revision | 清引用选择，保留必要来源与审计语义 | 无资产返回，不虚构组件出售 |
| save_layout/loadout | 同版本recipe、Creator允许范围 | 准确布局/revision/hash | 越界、未获许可、缺Adapter拒绝或标不可用 |
| list/cancel/buy_soul | root实际控制、全部Bound+已装Free清单、expectedRevision/hash、价格币种、quote期限 | 上架锁清单；成交清Grant＋付款＋root交接 | 清单变动/并发/旧报价失败；取消恢复可操作状态 |
| buy_item | 钱包持有或取出后可售Item、许可、quote | 原ID交接＋整数分账 | Bound/Reference独售拒绝 |
| grant/revoke/read | 当前真实Owner/认证容器、scope/expiry、issuer规则 | 写授权/撤销；读取按策略判断 | 过期/撤销/旧Owner/未经认证容器拒绝 |

全部可能产生费用/发行的命令使用attempt与事实读回恢复。交易原子性不自动提供跨交易幂等性；必须用链上或可验证请求记录防止第二笔重复业务动作。

## 状态、事件与错误

组合revision单调递增；每Part 0或1件固定Style。Free位置钱包→已装Soul→钱包；Bound选中/未显示都在原Soul；Ref有选择/清除。上架准备→已上架→成交或取消；未知为客户端观测状态，不是允许再付款的业务状态。

事件候选：SoulCreated、ItemIssued、CompositionChanged、ItemAttached/Detached、BoundMounted/Unmounted、GrantChanged/Revoked、ListingCreated/Cancelled、BundleSold、AccessPurchased。每个包含network/版本可关联的root或产品ID、source/version、attempt/quote与必要整数资金字段；不得放私密内容。

错误分类：Ownership、RightsMode、PartOccupied、StyleMismatch、UnsupportedAdapter、LicenceDenied、StaleRevision、StaleQuote、SupplyExceeded、AlreadyCompleted、PaymentMismatch、ContentUnavailable、UnsupportedContainer。SDK映射稳定错误码→用户可恢复操作，具体数值代码在实现后固定。

## 第三方标准

readSoul返回schemaVersion/identity/source、完整必要模块、recipe/revision/hash、所有Bound记录、当前Free对象ID/Type、权限能力摘要和缺失状态。readItem返回唯一ID、固定Style、来源/许可/表示及兼容目标。getSaleManifest提供准确范围和付款币种/整数金额；build交易返回对象版本依赖/范围预览；confirm读实际effects后展示成功。Indexer是检索，不替代Owner/许可/结算验证。

钱包、Kiosk、认证第三方容器分别验证owner路径和交易策略；key+store本身不证明所有市场规则可成交。跨容器转移和读取必须有专用验收样例。标准模块命名/版本、BCS编码、内容hash算法和AdapterID不能由前端各自发明。

依据：[Sui DOF](https://docs.sui.io/references/framework/sui_sui/dynamic_object_field)、[Sui transfer](https://docs.sui.io/references/framework/sui_sui/transfer)。具体framework版本在构建清单固定。
