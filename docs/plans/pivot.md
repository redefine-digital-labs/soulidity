# Soul 市场转向与链上授权重构计划

## Summary

将现有 `AgentBundle` 市场完整替换为 `Soul` 市场，首版按 `全链上 Soul V1` 落地：`Sui` 作为资产、订阅、授权的真相源；`Walrus` 负责存储 Soul 数据；`Seal` 负责访问控制；支付同时支持 `Sui USDC` 和 `Solana USDC`，但最终都结算映射到 Sui 上的 Soul 状态。开发态不保留旧市场数据，直接删旧表/旧路由/旧下载链路，不走双轨。

## Key Changes

- 领域模型改成两层：
  内部用 `SoulSeries` 表示作者维护的长期产品；用可转让的 `SoulPass` 表示买家持有的资产。`SoulPass` 分两类：`PerpetualPass` 对应一次性购买的指定版本永久访问，`SubscriptionPass` 对应订阅期内访问当前最新版本。
- 版本模型固定为 `单 Soul 多版本`：
  一个 `SoulSeries` 下挂多个 `SoulRelease`；作者发布新版本只新增 release 并更新 latest 指针，不新建新 Soul。
- 数据交付改为 `Walrus + Seal`：
  当前 zip/bundle 载荷保留原 AgentBundle 数据形态，但改为密文上传到 Walrus；公开元数据、预览图、readme 走公开引用；敏感 bundle 数据只通过 Seal 策略解密，不再生成 Supabase signed URL。
- 访问控制固定为 `单 agent 独占`：
  owner 可为每个 Soul 同时激活一个 agent grant；切换 agent 时覆盖旧 grant；grant 被撤销、Soul 转移、订阅过期、或 SoulPass 不再有效时，agent 访问立即失效。
- 购买主体支持 `人类 owner` 和 `agent`：
  人类购买时，SoulPass 归 owner，grant 默认为空；agent 购买时，SoulPass 仍归 owner，但自动把当前购买 agent 设为该 Soul 的 active grant。
- 定价模型固定为两类 plan：
  `one-time` 为某个 release 的永久买断；`subscription` 为手动链上续费的周期许可，首版支持固定周期档位，订阅有效期内访问 latest release。
- 支付轨道固定为 `双链并行 + Sui 记账`：
  Sui 侧直接用 `Sui USDC` 完成购买/续费并原子更新 Soul 状态；Solana 侧用 `Solana USDC` 支付，由支付验证与 relayer 服务把已确认结果提交到 Sui 链上完成铸造/续费。首版明确接受该 Solana->Sui settlement 依赖受信 relayer，而不是做信任最小化跨链桥。
- 仓库结构调整为三块：
  新增 Move 包目录用于 `SoulSeries / SoulRelease / SoulPass / SoulGrant / Seal approve`；`[prisma/schema.prisma](/Users/admin/Desktop/nao/clawnews/prisma/schema.prisma)` 改成链上事件索引读模型；`web/app` 下的 `market`/`api/market`/`api/agent/bundles` 全部替换为 `souls`/`api/souls`/`api/agent/souls`。
- 对外接口统一改名：
  页面从 `/market/*` 切到 `/souls/*`；API 从 `AgentBundle / Listing / PurchaseIntent / Entitlement` 语义切到 `Soul / Release / Plan / Pass / Grant / Settlement`；agent 侧下载接口改为“获取 Walrus 引用 + Seal 访问会话/参数”，不再返回直链下载 URL。
- 旧实现必须清理：
  删除 `AgentBundle`、`Listing`、`PurchaseIntent`、`Order`、`Entitlement` 及其 UI 文案；删除基于 Supabase bundle upload/download 的市场链路；删除 x402 paywalled bundle download 逻辑；保留与 Soul 无关的通用身份、钱包绑定、agent API key 能力。

## Implementation Changes

- 合约层：
  在新 Move 包中实现 `SoulSeries` 创建、release 发布、latest 指针更新、one-time 购买铸造 `PerpetualPass`、subscription 开通/续费/过期、SoulPass 转移、single active agent grant、以及供 Seal 调用的 `seal_approve_*` 访问策略。
- 存储与发布层：
  发布页改为先生成/校验 bundle manifest，再加密 bundle、上传 Walrus、拿到 blob 引用后提交上链发布 release；预览图和公开元数据同样脱离 Supabase，统一收敛到 Walrus/public metadata 引用。
- 结算与索引层：
  后端新增 Sui settlement 执行器、Solana 支付验证与 relayer、Sui 事件索引器；Postgres 只缓存 `SoulSeries`、`SoulRelease`、`SoulPassSnapshot`、`SoulGrantSnapshot`、`SettlementEvent` 等读模型，所有权限判断以链上结果为准。
- 前端与 agent 层：
  发布、列表、详情、我的资产、续费、切换授权 agent 全部改为 Soul 语义；agent 搜索和详情 API 保留，但购买后访问流程改成“验证 active grant -> 获取 Seal 会话 -> 拉 Walrus 密文 -> 由 agent 解密/导入”。
- 数据迁移：
  因为当前是开发数据，直接做 destructive reset；保留最少的账户、成员、钱包绑定基础数据，市场相关表和测试夹具按 Soul 新模型重建。

## Test Plan

- Move 单测：
  覆盖 Soul 创建、release 发布、latest 切换、一次性买断锁版本、订阅续费与到期、SoulPass 转移、agent grant 覆盖、转移/过期后 grant 失效、Seal approve 仅在合法 owner/agent 下通过。
- 后端集成测试：
  覆盖 Walrus 发布索引、Sui USDC 购买、Solana USDC 支付后 relayer 结算、agent 购买自动设 grant、owner 手动切换 grant、无效 grant/过期订阅/旧版本访问被拒绝。
- Web/API 测试：
  覆盖 `/api/souls/*` 与 `/api/agent/souls/*` 新接口、旧 `/market/*` 与 `/api/agent/bundles/*` 不再暴露、发布页/详情页/我的 Soul 页面新文案和新字段。
- 端到端场景：
  `作者发布 Soul -> 人类购买 one-time -> 转授权某 agent -> agent 成功获取数据`；
  `agent 直接购买 subscription -> owner 名下生成 pass 且该 agent 成为 active grant`；
  `作者发布新 release -> 订阅用户拿最新版本 -> one-time 用户仍只拿已购版本`；
  `SoulPass 转移后原 owner 与原 agent 失去访问，新 owner 可重新授权自己的 agent`。

## Assumptions

- `Soul` 是用户可见名称；内部允许拆成 `SoulSeries + SoulPass` 两层实现，以支撑一份内容被多次售卖且买家持有可转让资产。
- 首版只做作者主导的 primary sale，不做 UI 级二级市场撮合；`可转让` 先通过链上转移支持，后续再补 resale marketplace。
- agent 真实访问 Seal/Walrus 前必须有可识别的钱包/链上身份；现有 agent API key 继续用于应用层身份，链上 grant 绑定到该 agent 的 Sui 身份。
- Solana 支付到 Sui 状态映射首版接受受信 relayer；如果后续要做 trust-minimized bridge，再单独立项。
