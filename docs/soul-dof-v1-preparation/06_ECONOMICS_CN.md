# 经济规则、资金流与对账

当前金融适用范围是数字资产发行、付费资格、组件/组合成交、费用与Treasury。无借贷/Oracle/清算/YBT等新承诺。所有费率/币种/限额/供给/赞助预算未决，执行前填准确值。

## 业务资金与权利

Maker/Pack付费购买的是明确使用资格；产品控制权交易、Complete发行费用、可交易组件购买、Soul整套购买分别报价，不能重复收取或混淆对应权利。Pack三政策FREE/ONE_TIME_PAID/INCLUDED_WITH_MAKER对应不同资格核验，与三组件权利独立。

quote固定network、CoinType、price整数、decimals来源、收费项/收款人、feeSnapshot/version、供给/cap、attempt、expiry、对应Maker/Pack/Soul/Item/revision/hash。前端显示金额=整数÷10^decimals，仅展示用小数；资金计算不采用JS浮点。

## 分账与守恒

以某笔实际gross整数G、已定费率分母D/费率r为例，平台费F=floor(G*r/D)，剩余N=G−F；若多接收者，逐项按已固定舍入规则计算并将余数明确分配给指定接收者。F≤G，所有收入之和=G；0、最小单位、上限/溢出、不同CoinType与无效decimals需测试。此为候选规则，不是已决定费率或已部署结算。

交易支付收入与用户网络gas分开，不把用户gas当平台收入。资金明细登记所有成功/失败/取消/未知attempt，成功effects之后计已结算；退款/补偿必须独立授权与可验证digest，不能把链上不可逆成交称可回滚。

## 对账粒度

按network+CoinType+Treasury/收款对象范围计算：期末=期初+收入−支出。Object拆分/合并Coin要读balance与effects，不仅看单Coin ID；按digest/checkpoint去重。账本每行关联order/attempt/quote、收费项、root/Item/Maker/Pack、状态、expected/actual金额、收款/支出、差异原因和负责人。

链上账与业务账核对；索引落后/未知交易标临时差异，先查原digest/effects再补录，不重收费。Bound与Reference不作为可独售库存计价；已装Free是否随售按准确清单核对。

## 预算及持续管理

部署/初始化/测试Gas、Walrus保存/续期、Seal/RPC、索引、赞助交易分别预算，记录CoinType、额度、审批依据与实际支出。赞助方设置实际速率/额度/允许动作，防重放和刷费用；预算未定不启用。

经济指标：Complete成功/收费准确率、重复扣款、quote失效率、成交与拆装成功率、对账差异、内容到期与成本。真实窗口/数据源/分母在运行门禁前填，不编造GMV/APY。
