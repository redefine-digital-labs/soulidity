# Codex 独立审计报告 — soulidity Move

## 1. 总评

本次静态审计确认 **2 项 Medium、1 项 Low** 问题，主要涉及不可恢复的状态增长、集合绑定后的交易阻塞，以及内容 envelope 保留命名空间被通用配置入口覆盖。未确认非持有人盗取 NFT、绕过付款或未经授权通过 `seal_approve_*` 的 Critical / High 路径。Kiosk 托管、授权 epoch 隔离和关联对象 ID 检查整体较完整，但部分合法操作组合会产生当前接口无法恢复的状态。本报告结论针对所审阅源码；未完成链上字节码一致性、构建或运行测试验证。

以下生产源码位置均相对于 `move/soulidity/sources/`。

## 2. 发现汇总表

| ID | 严重度 | 位置 (module.move:line) | 标题 | 置信度 |
|---|---|---|---|---|
| CX-1 | Medium | `collection.move:193`、`collection.move:215` | 集合绑定未检查交易兼容性，可永久阻断 Soul 的现有出售路径 | 高，静态确认 |
| CX-2 | Medium | `content.move:140`、`content.move:715` | 无界版本向量可耗尽单对象容量，永久阻断 MEMORY 追加 | 高，静态确认 |
| CX-3 | Low | `market.move:1574`、`market.move:1590` | 通用配置入口可覆盖或删除内容 envelope 的保留键 | 高，静态确认 |

## 3. 发现详情

### CX-1：集合绑定未检查交易兼容性，可永久阻断 Soul 的现有出售路径

**位置**

- `collection.move:193–215`：`add_soul`。
- `soul.move:436–438`：单向设置 `collection_id`。
- `market.move:600–613`：native-V8 provenance 检查。
- `market.move:563–567`：组合费率上限。
- `market.move:1723–1724`、`market.move:1751`：普通交易入口限制。

**描述**

`add_soul` 在不可撤销地绑定集合之前，只检查创建者、当前所有者、未挂牌状态和供应量，没有检查绑定结果能否被任何市场路径处理。

已确认两种独立触发方式：将 native-V8 Soul 绑定集合；或将普通 Soul 绑定到版税合计超过市场上限的集合。生产代码没有集合解绑入口，也没有修改相关版税的入口。

**攻击或失效路径（逐步）**

路径一：native-V8 Soul。

1. 用户正常调用 `mint_animacraft_v8_in_personal_kiosk`，得到自己创建且持有的 native-V8 Soul。持有人检查见 `market.move:1100–1103`，创建者与所有者写入见 `market.move:2503–2524`。
2. 同一用户创建集合。`collection.move:154` 将集合创建者设置为 sender。
3. 在 Soul 未挂牌时调用 `collection::add_soul`。创建者、所有者和供应量检查全部可以通过；函数没有拒绝 native-V8 Soul。
4. `soul::bind_collection` 将 `collection_id` 永久设置为 `some(collection_id)`。
5. native-V8 挂牌必须先执行报价，其内部在 `market.move:610` 要求 `collection_id.is_none()`，因此失败。
6. 普通单独挂牌和集合挂牌又明确拒绝 native provenance，见 `market.move:1723`、`market.move:1751`。当前接口无法解除该状态。

路径二：不可满足的版税组合。

1. 在源码默认平台费为 250 bps、相关功能正常开启的配置下，用户铸造 creator royalty 为 6000 bps 的普通 Soul。铸造只检查 `250 + 6000 <= 10000`，因此允许，见 `market.move:2492–2495`。
2. 用户创建 extra royalty 为 5000 bps 的集合。创建集合只检查 `250 + 5000 <= 10000`，因此允许，见 `market.move:1439–1442`。
3. 调用 `add_soul` 成功。该函数没有检查两个版税的合计。
4. 单独挂牌因 Soul 已绑定集合而失败，见 `market.move:1724`。
5. 集合挂牌最终进入统一报价检查，因为 `creator royalty + collection royalty = 11000 bps` 而失败。即使管理员把平台费降到零，仍然不能通过。

**影响**

合法 owner/creator 可以通过正常授权操作，使自己的 Soul 在当前代码下持续无法挂牌和出售。NFT 已处于 Kiosk 锁定托管中，普通 `take` 或直接 Kiosk 成交无法替代需要私有市场 witness 的正式转移流程。

这不是陌生地址强制锁定他人资产，也没有证明 NFT 的内容读取同时失效，因此定为 Medium。

**修复建议**

在 `add_soul` 写入永久绑定前验证市场兼容性：

- 尚未支持 native-V8 集合结算时，明确拒绝绑定 native-V8 Soul。
- 检查 creator royalty 与 collection royalty 的组合；如要求立即可交易，还应纳入适用的平台费。
- 为已有错误绑定设计经相关权利人授权的恢复或迁移路径，避免修复时擅自取消集合持有人的经济权利。

仅在挂牌时继续报错不能解决已经形成的不可恢复状态。

**置信度与验证依据**

高。两条路径均已沿创建、绑定、报价、挂牌及托管限制逐行核对，并经独立交叉复核。未运行交易；“永久”指当前生产接口没有恢复路径，包升级或明确迁移可以改变这一结果。

### CX-2：无界版本向量可耗尽单对象容量，永久阻断 MEMORY 追加

**位置**

- `content.move:136–140`：`Table<ContentKey, vector<ContentSlot>>`。
- `content.move:481–513`：代理追加入口。
- `content.move:711–725`：向同一个向量持续追加。
- `content.move:814–818`、`content.move:852–860`：删除与 purge 不缩短向量。
- `content.move:1144–1148`：MEMORY 强制使用固定名称。
- `soul.move:451–453`：内容根只能绑定一次。

**描述**

每个 `(kind, name)` 的全部版本都内联存储在一个 dynamic-field 对象的向量中，且没有分页、容量回收或内容根迁移机制。

有效的 MEMORY grantee 可以持续增长唯一的 `(MEMORY, "default")` 向量，直至下一次追加超过单个 Move object 的大小限制。撤权、过期、转让、删除和 purge 都不会缩短该向量。

**攻击或失效路径（逐步）**

1. Owner 向地址 A 签发有效的 `scope_memory` grant。
2. A 反复调用 `append_version_as_granted_agent`，传入相同的 state/content、`kind=1`、`name="default"`、正确的当前版本索引、合法读取掩码、非空 envelope，以及每次由自己提供的独立 Walrus `Blob`。
3. `content.move:496–512` 验证 grant 后允许追加，没有版本数量或累计增长预算。
4. 每次调用在 `content.move:715` 执行 `vector::push_back`，增长同一个 table value。
5. 框架 `table.move:43–61` 将整个 value 交给 dynamic field；`dynamic_field.move:26–33` 确认完整向量内联存储于同一个 `Field` 对象。
6. 达到对象容量后，后续追加因对象过大而失败。本地缓存的执行源码 `crates/sui-types/src/object.rs:240–259` 明确返回 `MoveObjectTooBig`。
7. Owner 即使删除、purge 全部旧版本，也只会修改标志或销毁 Blob，不能移除 `ContentSlot`。MEMORY 又不能换名称，内容根也不能重新绑定，因此无法恢复追加。

**影响**

该 Soul 的 MEMORY 时间线会在当前接口下持续无法追加，故障跨授权撤销、过期和所有权轮换存续。正常长期使用也会自然达到相同状态。

攻击前提是先获得有效 MEMORY grant，并支付多次交易及 Blob 的成本；不是任意地址攻击。现有内容读取和 Soul 交易未因此必然失效。

**修复建议**

将版本元数据拆成独立对象，例如以 `(kind, name, version_index)` 为键逐条存储，另存固定大小的 next-version counter；或采用有界分页。

迁移应保留原有 version index、内容 ID 和 Seal document identity。仅设置最大版本数会把故障提前显式化，仍不能解决 canonical MEMORY 的长期可用性。已有对象升级时也不能直接假设可以改变 `SoulContent.items` 的既有布局。

**置信度与验证依据**

高。持续增长、单字段存储、对象大小拒绝路径和缺少回收入口均有直接源码依据，并经独立复核。

按当前 `ContentSlot` 的约 81 字节固定序列化大小，以及提供的缓存协议配置中 250 KiB 的对象上限估算，约数千个版本即可接近阈值。此数量不是主网实测值；本次没有查询主网协议参数，也没有执行容量测试。

### CX-3：通用配置入口可覆盖或删除内容 envelope 的保留键

**位置**

- `content.move:521–538`：生成并保存 envelope 配置键。
- `market.move:1574–1602`：V2 通用配置写入与删除。
- `market.move:1515–1543`：对应 V1 入口。
- `market.move:2585–2602`：只在初始化配置中执行的保留前缀检查。
- `soul.move:465–478`：任意键 upsert/remove。

**描述**

内容 envelope 使用 `content_seal_envelope_v1:` 前缀存储于 `SoulState.config_ext`。铸造初始化配置会拒绝该保留前缀，但后续通用 setter/deleter 只检查 owner 和键非空，没有继续保护该命名空间。

因此，包括 mint-once `SOUL_DOC v0` 在内的内容 envelope，都能被 owner 通过普通配置操作覆盖或删除。

**攻击或失效路径（逐步）**

1. Soul 正常完成铸造，`SOUL_DOC v0` 的 envelope 被写入 `config_ext`。
2. 当前 owner 根据公开的 content ID、kind、name 和 version，重算 `content.move:521–529` 定义的配置键；不需要哈希碰撞。
3. 调用 `set_state_config_v2` 写入任意字节，或调用 `delete_state_config_v2` 删除该键。
4. 两个入口均通过权限检查，并直接修改该 envelope，绕过初始化时的保留命名空间限制。
5. 后续出售仅轮换 owner/kiosk/epoch，不恢复 envelope，继任买方继续面对受损的当前 envelope 状态。

**影响**

普通配置编辑可以破坏历史内容、包括不可追加替换的 `SOUL_DOC v0` 的当前 envelope 可用性，使后续读取失败或要求额外恢复。

该问题需要当前 owner 权限；没有绕过 Seal 授权，也没有证明能替换固定 Blob 中的原始内容。原 envelope 可能从历史交易或外部副本恢复，因此定为 Low，不认定为必然永久丢失。

**修复建议**

在所有通用配置 setter/deleter 中统一拒绝保留前缀，将 envelope 写入限定在对应的内容操作内。若需要 envelope 恢复，应使用明确绑定内容对象和版本的专用验证流程。

**置信度与验证依据**

高。初始化防护与后续入口的检查差异、可公开重算的键、直接覆盖/删除行为均已逐行确认。`content.move:532–533` 已明确要求 reader 校验 envelope 身份；本发现不把受损 envelope 等同于成功解密或伪造原内容。

## 4. 已验证成立的关键不变量

- **内容根不能跨 Soul 混用。** `content.move:1091–1095` 同时检查 `content.soul_id` 和 state 中绑定的具体 content ID；paid list 也核对 Soul ID 与具体 list ID，见 `paid_access.move:685–690`。

- **内容 Seal 路径绑定具体文档与权限。** Owner、grantee、public 路径均检查对应 slot 的删除状态、读取掩码和精确 document ID，见 `content.move:962–1020`。Paid 路径额外按 sender、kind、scope、epoch 和 expiry 检查购买记录，见 `paid_access.move:656–682`。未确认未经授权的成功路径。

- **Seal document ID 没有发现可利用的解析歧义。** `content.move:1152–1204` 检查完整长度、domain、version、kind、content ID、名称终止符及版本索引；整数按大端逐字节检查。可写名称不允许 NUL，见 `content.move:1097–1111`。

- **Upload recovery 与正式内容命名空间分离。** `content.move:1026–1035` 使用不同 domain、固定长度并绑定 `ctx.sender()`，不能直接用于批准正式内容 document ID。

- **旧 grant 不能跨所有权轮换继续使用。** `grant.move:451–470` 检查 Soul、sender、epoch、expiry、active grant ID 及 scope；市场成交清零当前 grant count 后递增 epoch，见 `market.move:744–745`、`market.move:2973–2974`。

- **Grant 替换、撤销和容量计数未发现绕过。** 发行只允许 owner，scope 必须属于已知掩码，见 `grant.move:191–203`、`grant.move:500–506`。删除旧 epoch 行不扣减新 epoch 计数，见 `soul.move:573–586`；superseded grant 的旧 ID 会从索引删除。

- **Paid config 和 entry 均按 ownership epoch 隔离。** 新购买要求 config 属于当前 epoch，读取要求 entry 属于当前 epoch，见 `paid_access.move:426–432`、`paid_access.move:261–271`。续期使用 `max(now, previous_expiry)`，见 `paid_access.move:461`、`paid_access.move:491–496`；空 buyer table 在撤销或 stale cleanup 后回收，见 `paid_access.move:635–641`。

- **Paid purchase 不允许 owner 自买，付款精确匹配。** `market.move:2254–2279` 检查根对象绑定、非零价格、非 owner 买方和精确 USDC 金额，收款人为当前 owner。记录购买失败会使同一事务整体失败。

- **Kind descriptor 的权限组合受到约束。** `kind_registry.move:431–473` 限定已知位、强制 OWNER、同步 active-binding 标志，并要求 scoped read 使用单一合法 scope。历史 slot 缓存读取与操作权限，见 `content.move:690–707`。

- **SOUL_DOC 的 slot/Blob 绑定不能通过内容 CRUD 改写。** 首次入口限制为 canonical name 和单个初始版本，见 `content.move:568–582`；该 kind 的操作掩码为零，见 `kind_registry.move:216–225`。此结论不覆盖 CX-3 所述 envelope 层。

- **Blob 托管没有公开提取路径。** 追加将 Blob 放入 content 的 dynamic-object field，见 `content.move:728–732`；purge 仅 owner 可执行，且要求已经删除、尚未 purge，随后直接 `blob::burn`，见 `content.move:841–860`。

- **PurchaseCap 与 listing 生命周期保持封装。** Listing 为 key-only，cap 提取函数为私有，见 `market.move:189–217`、`market.move:3000–3009`。取消返还 cap 并清除挂牌状态；删除 active listing 或仍持 cap 的 listing 会失败，见 `market.move:1789–1799`、`market.move:2416–2449`。

- **直接 Kiosk 操作不能替代正式市场转移。** 已核对依赖源码：`kiosk/kiosk.move:325–335` 禁止取出 locked item，`:403–451` 约束排他 PurchaseCap；`kiosk/transfer_policy.move:184–199` 要求全部 rule receipts。市场 proof 无公开构造或返回入口，正式成交重新 lock、prove 并 confirm，见 `market.move:747–756`、`market.move:2976–2985`。

- **付款路由与整数计算未发现可利用的差额。** 普通报价使用 u128 并在转 u64 前检查总额，见 `market.move:563–578`；普通费用向上取整，native 费用向下取整，见 `market.move:3012–3021`。Creator 或 collection holder 等于 seller 时，对应金额保留在 seller 余款中，见 `market.move:2958–2971`。

- **Native-V8 witness 未公开泄漏。** 两种 witness 只有 `drop`，构造函数均为 `public(package)`，并从真实 state 导出 owner/epoch，见 `animacraft_v8_binding.move:18–69`。Native listing 检查 version 8 及相关对象快照，见 `market.move:696–705`。报价减法安全依赖外部 `assert_rights_snapshot_v8` 的可信接口约束，见 `market.move:593–597`。

- **Equipment 与挂牌状态相互约束。** Equipment create/read/update/close 检查 DF9/DF10 及 Soul/state ID，见 `animacraft_equipment_adapter_v8.move:27–36`、`:46–62`、`:78–83`。存在 equipment 时，`soul.move:444–448`、`:589–595` 禁止挂牌和 owner rotation；mutation wrapper 先验证 update guard。

- **Profile、social 和 community identity 未发现伪造路径。** Profile 更新核对 sender、registry、登记 ID 和 revision，见 `profile.move:174–230`；follow/vote 使用已登记 actor，见 `social.move:78–111`、`community_votes.move:62–91`。接受答案同时绑定原作者、post 和 comment，见 `community_posts.move:164–177`。

- **私有 head 的作用域和 CAS 成立。** Bookmarks Seal ID 使用实际 sender；named-loadout 绑定当前 owner、Soul/state 和 epoch，见 `profile.move:254–265`、`named_loadout_v1.move:65–93`。两者 replay receipts 有界为 32 条，新请求执行 revision 检查，见 `profile.move:336–353`、`named_loadout_v1.move:140–158`。专用类型 DF key 与公开 String config 不共用命名空间。

## 5. 范围与限制

**审阅范围**

已逐文件完整阅读指定的 14 个生产模块，以及 `Move.toml`、完整 `Move.lock` 和 `Published.toml`。测试代码仅作为行为和生产可见性的参考，没有将测试辅助入口当作生产能力。未读取 `docs/audits/` 或被禁止的代理配置目录，未修改任何文件，未运行构建或测试。

**依赖与外部接口**

- Kiosk、TransferPolicy、personal kiosk、dynamic field、dynamic object field、coin 和 Walrus Blob 的关键语义均核对了本地依赖源码。
- Animacraft 四个包按要求作为可信接口边界，只审查 soulidity 的入参、前后置检查和 witness 使用，没有检查其内部实现。
- `Move.toml:6–7` 与 `Move.lock:85–107` 使用缺失的绝对本地 Animacraft 路径，无法在本机复现完整依赖或执行验证。
- USDC、Kiosk 和 Walrus 使用固定 Git commit；主网地址替换未发现直接类型混淆，见 `Move.toml:8–12`、`:17–21`。

**`derived_object` 的证据边界**

指定的 `a4185…` framework 缓存没有 `derived_object.move`；`Move.lock:43–47` 中根包实际使用的 Sui revision 为 `2a0bec…`，本机没有该版本源码。额外本地 framework 缓存可用于参考 claim 的占位及类型隔离语义，但不能冒充锁定版本验证；尝试读取官方锁定源码也未成功。

调用方已确认使用真实 sender 作为 author、限制 nonce 并核对预期 ID，见 `market.move:2530–2534`；锁定版本的 `derived_object` 实现仍属于未完成验证项。

**V1 / V2 的实际可达性**

当前源码的 production `init` 只创建 `MarketConfigV2`，见 `market.move:403–404`、`:3103–3128`；`MarketConfig` 的唯一当前构造位于 `#[test_only] init_impl`，见 `market.move:3156–3181`。因此，按当前源码 fresh publish，没有生产 V1 config 来源，也不能由普通用户构造一个 V1 config 来绕过 V2 门控。

但 `Published.toml:5–12` 记录的是主网 version 2。当前源码不能证明历史 version 1 从未创建同 type-origin 的 V1 config；若历史对象存在，V1 入口检查其自身 `paused`，不会自动服从 V2 两个 gate。本次主网 RPC 请求因 DNS 解析失败，未能核实历史对象，因此**不能认定该部署上的 V1 入口实际不可达，也未将其报告为已证实的暂停绕过漏洞**。

**部署、升级与运行限制**

- 未核对本地源码与 `Published.toml` 所列包的链上字节码一致性，也未比较历史 struct layout，不能确认升级兼容性或认定上述问题已在主网发生。
- `market.move:173–183` 的 `#[test]` 地址断言属于测试代码；未运行该断言，也未将它视为主网地址校验。
- 未执行真实 Seal 请求、PTB、容量测试或吞吐测试。全局 registry 的共享写争用属于可见扩展性边界，但缺少实际拥塞证据，未单独列为安全漏洞。
- 所有修复建议均为报告建议；本轮没有实施、部署或改变任何运行时权限。