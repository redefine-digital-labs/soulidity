# Soulidity 主网部署 + AdminCap 多签托管

## Context

把 ClawNews 仓库下 `move/soulidity` 合约首次发布到 Sui **mainnet**，并在 publish 成功后立刻用第二笔 PTB 把 6 个治理对象转入企业多签地址 `0xcaab58c145b4c0479f662a88bcb9d4db9f1f391f8ec19535b1ef75ce08879294`，让链上治理职能（升级合约、改费率、改 transfer policy、维护 NFT Display）从 deployer EOA 迁移到多签控制。

重要边界：当前合约 init 会把这些对象先发给 `ctx.sender()`，Sui publish 本身也会把 `UpgradeCap` 先给 publisher，所以本方案不是 single-transaction atomic custody handoff。它的目标是 **publish 后立即 transfer，且 manifest 明确标记 transfer 是否完成**。如果要求“从未落入 deployer EOA”，必须改成多签直接 publish，或先改合约 init 支持治理接收方后再发布。

阻塞性约束：
- `move/soulidity/sources/market.move:24` 引用 `usdc::usdc::USDC`，Move.toml 当前指向 `move/test_usdc`（addr `0x79d8bbac...`）。直接发主网会得到只能收 testnet fake USDC 的"瘸腿合约"，**必须先把 `usdc` 依赖切到 Circle 主网 stablecoin-sui 仓库**。
- `Walrus` 依赖同理，当前 `testnet-contracts/walrus` 指向 testnet 包，主网必须切到 `mainnet-contracts/walrus`。
- `move/vendor/kiosk/Move.toml` 当前 `[addresses] kiosk = "0xc9f6..."` 是 testnet 包；mainnet RPC 返回 `notExists`。**必须先发布或 pin 一个 mainnet 可用的 personal_kiosk/rules 包**，并同步 `NEXT_PUBLIC_KIOSK_PACKAGE_ID`。
- 现有 `scripts/publish-soulidity-and-sync.ts` 只做 publish + manifest 同步，**不会自动 transfer cap**，发完合约 6 个治理对象全留在 deployer 钱包。
- 主网部署不再依赖 `sui client active-address`，改用仓库 `.env` 中的 `MAINNET_DEPLOYER_PRIV_KEY` 直接 sign & execute，这样发布身份与 cap transfer 身份强一致、可审计、CI/外部主机也能跑。
- root `package.json` 当前没有 `@mysten/sui` 依赖；如果 publish 脚本改成 TS SDK 模式，要么把 `@mysten/sui` 加到 root dependencies，要么沿用 `NODE_PATH=web/node_modules` 运行约定。推荐加 root dependency，避免主网脚本依赖隐式 NODE_PATH。

## 需进多签的对象清单（共 6 个）

| 对象 | 类型 | 来源 | 当前默认接收方 |
|---|---|---|---|
| MarketAdminCap | `soulidity::market::MarketAdminCap` | `market.move:1983` | `ctx.sender()` |
| Soul TransferPolicyCap | `0x2::transfer_policy::TransferPolicyCap<...::soul::Soul>` | `market.move:1984` | `ctx.sender()` |
| Collection TransferPolicyCap | `0x2::transfer_policy::TransferPolicyCap<...::collection::SoulCollectionRight>` | `market.move:1985` | `ctx.sender()` |
| UpgradeCap | `0x2::package::UpgradeCap` | sui publish 系统生成 | publisher |
| Soul Display | `0x2::display::Display<...::soul::Soul>` | `soul.move:85` | `ctx.sender()` |
| Collection Display | `0x2::display::Display<...::collection::SoulCollectionRight>` | `collection.move:62` | `ctx.sender()` |

共享对象 `MarketConfig`、`KioskRegistry`、`MarketUpgradeState`、`TransferPolicy<Soul>`、`TransferPolicy<SoulCollectionRight>` 在 init 内 `share_object` 后人人可读，无需也无法 transfer。`Publisher` 在两个模块 init 末尾立即 `.burn()`，不需要处理。

**为什么这 6 个对象都进多签（不留 deployer EOA）：**
- `MarketAdminCap`：费率、暂停、kiosk 注册、upgrade 授权 — 高频治理，必多签。
- `UpgradeCap`：包升级权 — 主网最敏感单点，必多签。
- `TransferPolicyCap × 2`：持有者能 add/remove rule（解除 personal_kiosk_rule 等）或 destroy policy。留 EOA 等于"任何时候 deployer 单方能让 Soul 绕过 market 直接转出"，是不可接受的单点风险。
- `Display × 2`：持有者能改全网 Soul / Collection NFT 的 name/image_url/description 模板。留 EOA 等于"deployer 单方能篡改用户钱包里看到的 NFT 内容"，同样是单点风险。更新展示频率低，多签流程延迟可接受。

## 实施步骤

### 1. 选定 + 校验 mainnet Kiosk package（走官方）

**决策（2026-04-26）**：mainnet kiosk 用官方已部署的 `MystenLabs/apps` kiosk package，**不自发**。原因：避免我方持有 vendor kiosk 的 UpgradeCap 单点权限、与生态 marketplace 调用面统一。

当前 `move/vendor/kiosk/Move.toml` 里：

```toml
[addresses]
kiosk = "0xc9f6a531d5f4e11ef38dd782c9ab5403fb3c011595384c429285952ff6b31839"
```

这是 testnet 包，必须替换为官方 mainnet `<official-mainnet-kiosk-id>`。

**硬性校验清单（任一失败 → 停手回到自发路径）：**

1. **拿到 64-hex package id**：从 Mysten 官方渠道（SuiScan / docs / GitHub release notes / mainnet 已知 dApp 调用面如 OriginByte / TradePort）确认官方 `MystenLabs/apps` kiosk 的 mainnet published package id。**禁止** PR / Move.toml 留 `<official-mainnet-kiosk-id>` 占位上线，必须 pin 真值。
2. **Immutable 校验**：
   ```bash
   sui client --client.env mainnet object <official-mainnet-kiosk-id> --json | jq '{type: .data.type, owner: .data.owner, version: .data.version}'
   # 期望: type = "package", owner = "Immutable"
   ```
3. **模块 / 函数签名 binary-compat 校验**：
   - `sui client --client.env mainnet object <official-mainnet-kiosk-id> --json` 拉取 normalized modules；
   - 用 `sui move disassemble` 或 SDK `getNormalizedMoveModule` 比对官方包 vs 当前 `move/vendor/kiosk/sources/`：`personal_kiosk`、`personal_kiosk_rule`、`witness_rule` 三个模块的 public 函数签名（参数类型、返回类型、generic constraints）必须严格一致；
   - 任何签名不匹配 → 立即停手，回退到自发路径（见本节末"回退方案"）。
4. **Web 端 tx builder smoke**：在 testnet 用临时把 `NEXT_PUBLIC_KIOSK_PACKAGE_ID` 切到本地一个简易 fork（保留官方 publishing flow 验证），跑通 `web/lib/soulidity/tx/personal-join.ts` 等关键 builder 的 dry-run，确认运行时类型解析无误。

校验通过后同步：

```toml
# move/vendor/kiosk/Move.toml
[addresses]
kiosk = "<official-mainnet-kiosk-id>"
```

把 `.env.example` / Vercel / Desktop build env 中的 `NEXT_PUBLIC_KIOSK_PACKAGE_ID` 切到同一个 `<official-mainnet-kiosk-id>`。

**已接受残余风险（写入 PR 描述与 runbook）：**
- 官方 kiosk 包升级权由 Mysten 持有；若官方升级引入 binary-incompat 改动，我方合约调用面（`personal_kiosk_rule::*`、`witness_rule::*`）可能在新版本下失败 → 缓解：order book 监控 + 升级前先在 testnet 校验同 tag 已发布且签名兼容。

**回退方案：** 上述 1-4 任一失败 → 改为自发 `move/vendor/kiosk`：发布到 mainnet 拿到 `<self-published-kiosk-id>`，并把生成的 `UpgradeCap` 同步转入企业多签 `0xcaab…9294`（独立于 soulidity 6-cap 转移，写入 manifest 的 `kioskVendorUpgradeCapId` 字段）。

**分支策略（S4 已决策）：**

主网与测试网 `Move.toml` / `Move.lock` / `Published.toml` / 两个 deployment manifest **不在同一分支日常切换**，避免反复改写引入飘忽。

- **新分支** `release/mainnet-v1` 从当前 `master` 切出，所有 mainnet 配置改动只在该分支 commit；
- **`master` 始终保持 testnet 配置**，正常 PR/CI/dev workflow 不变；
- **同步规则**：
  - 业务代码（合约源码、TS SDK、UI、tests）以 `master` 为单一来源 → cherry-pick / merge 到 `release/mainnet-v1`；
  - **绝不反方向**：mainnet 配置改动禁止回流 master；
  - cherry-pick 必须排除 `move/soulidity/Move.toml` / `Move.lock` / `Published.toml` / `web/lib/soulidity/deployment-manifest.json` / `desktop/.../deployment.ts` / `.env.example` 主网行 — 用 `git cherry-pick -- <path>` 限制范围或事后 `git checkout master -- <path>` 还原；
- **CI 区别**：`release/mainnet-v1` 跑 mainnet build smoke；`master` 跑 testnet（不变）；
- **Vercel 部署**：`release/mainnet-v1` → production，`master` → preview/staging；env 在 Vercel Dashboard 单独配置；
- **首发流程**：本计划 step 2-7 的所有改动 PR 到 `release/mainnet-v1` review → 在该分支跑 publish → 脚本回写的 manifest / Published.toml 直接 commit 到该分支；
- **回滚**：mainnet 出问题时，前端 / Desktop 可独立 rollback（旧 release tag），合约层走 `MarketUpgradeState` 升级路径（独立于分支策略）。

### 2. 切换 Move 依赖到主网

修改 `move/soulidity/Move.toml`：

```toml
[package]
name = "soulidity"
edition = "2024.beta"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "<mainnet-release-tag>", override = true }
usdc = { git = "https://github.com/circlefin/stablecoin-sui.git", subdir = "packages/usdc", rev = "<mainnet-tag>" }
Walrus = { git = "https://github.com/MystenLabs/walrus.git", subdir = "mainnet-contracts/walrus", rev = "<walrus-mainnet-rev>" }
Kiosk = { local = "../vendor/kiosk", override = true }

[addresses]
soulidity = "0x0"
```

注意：
- `Sui` rev **必须 pin 到具体 mainnet release tag**（如 `mainnet-v1.70.2`），**禁止用 `framework/mainnet` 分支引用** — 分支是漂移的，不可重现。执行前用 `git ls-remote https://github.com/MystenLabs/sui <tag>` 校验该 tag 存在；本次实际所用 tag 写入 PR description 与 `Published.toml` 注释。
- `usdc` 改成 Circle 官方 stablecoin-sui 仓库的 `packages/usdc`，rev 选最新 mainnet tag。该仓库内部 `Move.toml` 自带主网 `[addresses] usdc = "0xdba34672..."`，会同时给我们 `USDC` type 和 mainnet 包地址。
- `Walrus` subdir 改 `mainnet-contracts/walrus`，rev 取 walrus 仓库的 mainnet release commit。
- `Kiosk` 仍可保持 local source 引用，但 `move/vendor/kiosk/Move.toml` 的 `[addresses] kiosk` 必须已经是 mainnet package id，不能继续用 testnet `0xc9f6...`。
- 删除 `move/soulidity/Move.lock` 让 sui CLI 重新解析依赖；`move/soulidity/Published.toml` 保留 testnet 段。TS SDK publish 不会自动生成 / 追加 `[published.mainnet]`，publish 脚本必须显式写回 mainnet 段。
- **mainnet build 后**新生成的 `Move.lock` **必须 commit 到 `release/mainnet-v1` 分支**（连同 `Move.toml`、`Published.toml` mainnet 段一起），否则下次 CI / 其他人复跑会再次走依赖解析、可能命中漂移 → 列入 step 5 deliverables 检查清单。

### 3. 给 publish 脚本加 env 私钥模式 + cap 转移

`scripts/publish-soulidity-and-sync.ts` 当前用 `sui client publish` 子进程依赖 active-address；主网改造为 **TS SDK + env 私钥**两笔交易完成「发布 → 转 cap」，testnet signing 路径保持 CLI 模式，但注意 Move 依赖切到 mainnet 后不应再直接 testnet publish，除非先恢复 testnet dependency/address set。

**root dependency：**
- 在 root `package.json` 增加 `@mysten/sui`，版本与 `web/package.json` 保持一致（当前 web 为 `^2.15.0`）。
- 不推荐让主网发布脚本依赖 `NODE_PATH=web/node_modules`，该约定只适合临时脚本。

**新 env：**
- `MAINNET_DEPLOYER_PRIV_KEY` — Sui 私钥，支持 bech32 (`suiprivkey1...`) / base64 / 0x hex 三种格式。
- **必须先抽 keypair helper**：当前 `scripts/batch-publish.ts:137-164` 的 `getKeypair()` 是私有、硬绑 `BATCH_SIGNER_SECRET_KEY`。需先发独立 PR：
  - 新建 `scripts/lib/keypair.ts`，导出 `loadKeypairFromEnv(envName: string): Ed25519Keypair`（参数化 env 名）；
  - `scripts/batch-publish.ts` 改为 `loadKeypairFromEnv('BATCH_SIGNER_SECRET_KEY')`；
  - 新 publish 路径用 `loadKeypairFromEnv('MAINNET_DEPLOYER_PRIV_KEY')`；
  - **禁止复制粘贴**：密钥解析是安全敏感代码，重复实现会偏移。
  - 该 helper PR 先 merge 到 `master`，再 cherry-pick 到 `release/mainnet-v1`。
- `.gitignore` 当前只忽略 `.env`；先补 `.env.local`，再允许把主网私钥写入本地环境文件。
- `.env.example` 增补 `MAINNET_DEPLOYER_PRIV_KEY=` 占位行 + 一句 "deployer wallet for one-shot mainnet publish, transfer caps to multisig immediately after"。

**新增 CLI 参数：**
- `--transfer-caps-to=<address>`：传入触发 publish-then-transfer 流程；mainnet 默认必传（脚本在 `network === 'mainnet'` 时若缺失直接报错）。
- `--track-upgrade-cap` / `--no-track-upgrade-cap`：默认 `true`，在 transfer PTB 内顺带调 `market::track_upgrade_cap`，让 `MarketUpgradeState` 记录 UpgradeCap ID，多签后续升级直接走 `authorize_upgrade` → `commit_upgrade`。
- `--payment-coin-type=<type>`：mainnet 首次发布必须传或 manifest 已 seed。
- `--dry-run`：保留语义；TS SDK 模式下走 `client.devInspectTransactionBlock` 模拟。
- `--resume-cap-transfer-from-manifest`：publish 已成功但 `capTransferTxDigest` 缺失时，只重发 track + transfer PTB，不重发 publish。
- `--dry-run-transfer-only`：基于 manifest 里的对象 ID 对 transfer PTB 做 devInspect / dry-run，不执行。

**重构后的执行模型：**

```ts
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'

// 新增分支（network === 'mainnet' 或显式 --use-env-key）
const keypair = loadKeypairFromEnv('MAINNET_DEPLOYER_PRIV_KEY')
const deployerAddr = keypair.toSuiAddress()
const client = new SuiJsonRpcClient({
  url: getJsonRpcFullnodeUrl('mainnet'),
  network: 'mainnet',
})

// 1) 用 sui CLI 子进程只做 build（不发布），拿到 modules + dependencies
const buildOut = execFileSync('sui', [
  'move', 'build',
  '--dump-bytecode-as-base64',
  '--path', tempPackageDir,
], { encoding: 'utf8' })
const { modules, dependencies } = JSON.parse(buildOut)

// 2) 第一笔交易：publish
const publishTx = new Transaction()
const [upgradeCap] = publishTx.publish({ modules, dependencies })
publishTx.transferObjects([upgradeCap], publishTx.pure.address(deployerAddr))
publishTx.setSender(deployerAddr)
publishTx.setGasBudget(BigInt(gasBudget))
const publishRes = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: publishTx,
  options: { showObjectChanges: true, showEvents: true },
})
assertTxSuccess(publishRes, 'publish')
const deployment = extractDeploymentFromPublishResult(publishRes, previousDeployment, paymentCoinType)
// + 从 objectChanges 解析:
//   marketAdminCapId: `${packageId}::market::MarketAdminCap`
//   soulPolicyCapId: `0x2::transfer_policy::TransferPolicyCap<${packageId}::soul::Soul>`
//   collectionPolicyCapId: `0x2::transfer_policy::TransferPolicyCap<${packageId}::collection::SoulCollectionRight>`
//   soulDisplayId: `0x2::display::Display<${packageId}::soul::Soul>`
//   collectionDisplayId: `0x2::display::Display<${packageId}::collection::SoulCollectionRight>`
manifest[network] = deployment
writeJsonFile(manifestPath, manifest)
writePublishedTomlMainnet(sourcePublishedTomlPath, {
  chainId: execFileSync(suiBin, ['client', '--client.env', 'mainnet', 'chain-identifier'], { encoding: 'utf8' }).trim(),
  packageId: deployment.packageId,
  originalId: deployment.packageId,
  version: 1,
  toolchainVersion: resolveSuiToolchainVersion(suiBin),
  upgradeCapId: deployment.upgradeCapId,
})

// 3) 第二笔交易：track_upgrade_cap + transfer 6 objects 到多签
if (transferCapsTo) {
  const transferTx = new Transaction()
  if (trackUpgradeCap) {
    transferTx.moveCall({
      target: `${deployment.packageId}::market::track_upgrade_cap`,
      arguments: [
        transferTx.object(deployment.upgradeStateId),
        transferTx.object(deployment.marketAdminCapId),
        transferTx.object(deployment.upgradeCapId),
      ],
    })
  }
  transferTx.transferObjects(
    [
      transferTx.object(deployment.marketAdminCapId),
      transferTx.object(deployment.soulPolicyCapId),
      transferTx.object(deployment.collectionPolicyCapId),
      transferTx.object(deployment.upgradeCapId),
      transferTx.object(deployment.soulDisplayId),
      transferTx.object(deployment.collectionDisplayId),
    ],
    transferTx.pure.address(transferCapsTo),
  )
  transferTx.setSender(deployerAddr)
  transferTx.setGasBudget(200_000_000n)
  const transferRes = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: transferTx,
    options: { showEffects: true },
  })
  assertTxSuccess(transferRes, 'cap transfer')
  manifest[network].multisigOwner = transferCapsTo
  manifest[network].capTransferTxDigest = transferRes.digest
  manifest[network].trackUpgradeCapTxDigest = trackUpgradeCap ? transferRes.digest : undefined
  writeJsonFile(manifestPath, manifest)
}
```

**testnet signing 路径保持不变**：`network !== 'mainnet'` 且无 `MAINNET_DEPLOYER_PRIV_KEY` 时继续走原 `sui client publish` 子进程模式。但如果本分支已把 Move dependencies / Kiosk address 切到 mainnet，不允许直接 testnet publish；要先恢复 testnet dependency set 或使用专门的 testnet branch。

**SoulidityDeployment interface 扩展：**
- `multisigOwner?: string` — 多签地址
- `capTransferTxDigest?: string` — cap 转移交易 digest
- `trackUpgradeCapTxDigest?: string` — 和 cap transfer 同笔交易时等于 `capTransferTxDigest`
- `marketAdminCapId?: string`、`soulPolicyCapId?: string`、`collectionPolicyCapId?: string` — 4 个 cap 中尚未在现有 interface 的 3 个
- `soulDisplayId?: string`、`collectionDisplayId?: string` — 两个 Display 对象 ID

### 4. 提前 seed 主网 manifest 条目

由于 `extractDeploymentFromPublishResult` 要求 `paymentCoinType` 必须从前置 manifest 或 `--payment-coin-type` 取得，首次主网发布前手动给 `web/lib/soulidity/deployment-manifest.json` 加占位条目（避免脚本中途因缺字段抛错）：

```json
{
  "testnet": { ... 不动 ... },
  "mainnet": {
    "packageId": "",
    "marketConfigId": "",
    "kioskRegistryId": "",
    "soulTransferPolicyId": "",
    "collectionTransferPolicyId": "",
    "paymentCoinType": "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"
  }
}
```

发布脚本运行后会原地覆盖填入真实 ID。

### 5. 执行主网发布

**前置（按顺序检查，任一不满足则停手）：**
- 当前 checkout 已切到 `release/mainnet-v1` 分支。
- root `package.json` / `package-lock.json` 已加入 `@mysten/sui`。
- `.gitignore` 已包含 `.env` 和 `.env.local`。
- `scripts/lib/keypair.ts` 已存在（B2 helper PR 已合入）。
- `move/vendor/kiosk/Move.toml` 已指向官方 mainnet Kiosk package id（B3 校验全过），且 `NEXT_PUBLIC_KIOSK_PACKAGE_ID` 已同步。
- `move/soulidity/Move.toml` 的 Sui rev 已 pin 到具体 mainnet release tag（不是 `framework/mainnet` 分支），并已 `git ls-remote` 校验 tag 实际存在。
- **mainnet build smoke 已跑通**：`cd move/soulidity && rm -f Move.lock && sui move build` 干净通过（无 warning、无 unused imports），生成的 `Move.lock` 已暂存待 commit。
- deployer 钱包有 ≥ 1.5 SUI（脚本启动时 `client.getBalance` 二次校验）。
- 把 deployer 私钥写入 `.env` 或 `.env.local`：

```
MAINNET_DEPLOYER_PRIV_KEY=suiprivkey1...
```

```bash
# 主网发布 + 自动 track_upgrade_cap + 自动转 6 个对象到多签
NEXT_PUBLIC_SUI_NETWORK=mainnet \
  npm run publish:soulidity -- \
    --gas-budget=1500000000 \
    --transfer-caps-to=0xcaab58c145b4c0479f662a88bcb9d4db9f1f391f8ec19535b1ef75ce08879294
```

脚本检测 `network === 'mainnet'` 走新 TS SDK 路径，**fail-fast 顺序**：
1. 解析 `MAINNET_DEPLOYER_PRIV_KEY`（缺失立即退出，不进入任何后续步骤）；
2. 解析必需 CLI flags（`--transfer-caps-to`、`--payment-coin-type` 或 manifest 已 seed）；
3. `client.getBalance({ owner: deployerAddr })` 校验 ≥ 1.5 SUI（不足直接退出，不进入 build）；
4. `sui move build --dump-bytecode-as-base64` 拿 `{ modules, dependencies }`；
5. publish 交易 → 写 manifest + `Published.toml`；
6. transfer + track PTB → 回写 manifest cap 字段。

预期输出（JSON）包含：`packageId`、`marketConfigId`、`kioskRegistryId`、`soulTransferPolicyId`、`collectionTransferPolicyId`、`upgradeCapId`、`upgradeStateId`、`marketAdminCapId`、`soulPolicyCapId`、`collectionPolicyCapId`、`soulDisplayId`、`collectionDisplayId`、`publishTxDigest`、`capTransferTxDigest`、`multisigOwner`。

**回滚思路：** 如果 publish 成功但 transfer PTB 失败（gas、网络抖动、对象 ID 解析错等），manifest 已有 publish 字段但 `capTransferTxDigest` 缺失。脚本提供 `--resume-cap-transfer-from-manifest` 模式，重新基于 manifest 已记录的 6 个对象 ID 重发 transfer PTB（不重发 publish）。极端情况下可直接用同一 `MAINNET_DEPLOYER_PRIV_KEY` 通过 `sui keytool import` 后用 `sui client ptb` 手敲一笔。

**中间态可观测性：**
- publish 成功但 transfer 阶段出错时，stderr 必须打印固定标记 `SOULIDITY_PARTIAL_DEPLOYMENT_NEEDS_RESUME=<packageId>`，便于 grep / log alert；
- manifest 同时写入 `partialDeploymentReason: string` 字段记录失败原因（gas 不足 / network / objectId 解析失败等）；
- exit code 区分：publish 失败 = 1，transfer 失败 = 2，前置校验失败 = 3。便于 wrapper 脚本判断是否调用 resume 模式。

### 6. 同步下游消费方

| 文件 | 操作 |
|---|---|
| `web/lib/soulidity/deployment-manifest.json` | publish 脚本自动写入 mainnet 段，**人工核对**字段非空 |
| `desktop/apps/desktop/src/renderer/lib/soulidity/deployment.ts` | 手动复制 mainnet 段到 `deploymentManifest.mainnet` 内联对象（Desktop 不读 JSON） |
| `.env.example` | 在 `NEXT_PUBLIC_SUI_NETWORK=` 注释下追加主网示例值；补 `NEXT_PUBLIC_KIOSK_PACKAGE_ID=<mainnet-kiosk-package-id>`、`MAINNET_DEPLOYER_PRIV_KEY=` 占位；说明 `NEXT_PUBLIC_PRIVY_APP_ID` 主网/测试网用不同 App ID。不要重新加入 `NEXT_PUBLIC_SOULIDITY_*` 六个旧 env，当前真值来自 deployment manifest |
| `.gitignore` | 加 `.env.local` |
| `move/soulidity/Published.toml` | 由 publish 脚本显式追加 / 更新 `[published.mainnet]` 段；TS SDK publish 不会自动生成 |

Vercel / 生产 env 切换由用户在 Vercel Dashboard 手动改（不进代码）：
- `NEXT_PUBLIC_SUI_NETWORK=mainnet`
- `NEXT_PUBLIC_PRIVY_APP_ID=<mainnet privy app id>`
- `NEXT_PUBLIC_KIOSK_PACKAGE_ID=<mainnet-kiosk-package-id>`
- 检查 `NEXT_PUBLIC_SEAL_SERVER_CONFIGS`、Walrus aggregator 是否切到 mainnet

### 7. Verification（必须全部通过）

**链上对象归属：**
```bash
# 6 个对象都应 Owner = 0xcaab58c145b4c0479f662a88bcb9d4db9f1f391f8ec19535b1ef75ce08879294
for obj in <adminCap> <soulPolicyCap> <collectionPolicyCap> <upgradeCap> <soulDisplay> <collectionDisplay>; do
  sui client --client.env mainnet object $obj --json | jq '{id: .data.objectId, owner: .data.owner, type: .data.type}'
done

# 多签持有清单交叉核对
sui client --client.env mainnet objects 0xcaab58c145b4c0479f662a88bcb9d4db9f1f391f8ec19535b1ef75ce08879294 --json | \
  jq '[.[] | select(.data.type | test("MarketAdminCap|TransferPolicyCap|UpgradeCap|Display"))]'
```

**MarketUpgradeState 已绑定 UpgradeCap：**
```bash
sui client --client.env mainnet object <upgradeStateId> --json | jq '.data.content.fields | {tracked_upgrade_cap_id, upgrade_cap_live, tracked_upgrade_version}'
# 期望: tracked_upgrade_cap_id = <upgradeCapId>, upgrade_cap_live = true
```

**MarketConfig 默认费率合理：**
```bash
sui client --client.env mainnet object <marketConfigId> --json | jq '.data.content.fields | {fee_recipient, platform_fee_bps, paused}'
```

**端到端 smoke：**
- `cd web && NEXT_PUBLIC_SUI_NETWORK=mainnet NEXT_PUBLIC_KIOSK_PACKAGE_ID=<mainnet-kiosk-package-id> npm run build` 通过（manifest 已含 mainnet）。
- 本地 `npm run dev` 把网络切 mainnet，连主网钱包打开 `/market`，确认列表能加载、价格用 USDC（6 位小数）显示。

**资金 smoke（需要单独人工确认，不属于默认自动 gate）：**
- 拿一个测试主网钱包做 1 USDC 极小额 list → buy 闭环；执行前必须确认测试资金、买卖双方钱包和预期成本。

**Desktop verify：**
- Desktop 切换 mainnet 后 `app/market` 页面能正常渲染（确认 hardcoded manifest mainnet 段写对了）。

## 关键文件清单

修改：
- `package.json` / `package-lock.json` — root 增加 `@mysten/sui`，支撑 TS SDK publish
- `.gitignore` — 加 `.env.local`
- `move/vendor/kiosk/Move.toml` — 指向官方 mainnet Kiosk package id（仅 release/mainnet-v1 分支）
- `move/soulidity/Move.toml` — 主网依赖切换（仅 release/mainnet-v1 分支）
- `move/soulidity/Move.lock` — mainnet build 后新生成的 lock，必须 commit（仅 release/mainnet-v1 分支）
- `scripts/batch-publish.ts` — `getKeypair()` 改用共享 helper
- `scripts/publish-soulidity-and-sync.ts` — 加 transfer-caps + track-upgrade-cap 流程 + 共享 keypair helper
- `web/lib/soulidity/deployment-manifest.json` — seed mainnet 占位 + 自动覆盖（仅 release/mainnet-v1 分支）
- `move/soulidity/Published.toml` — publish 脚本显式追加 / 更新 `[published.mainnet]`（仅 release/mainnet-v1 分支）
- `desktop/apps/desktop/src/renderer/lib/soulidity/deployment.ts` — 加 mainnet 段（仅 release/mainnet-v1 分支）
- `.env.example` — 补主网占位
- `.husky/pre-commit` — 新增私钥真值拦截（如目录不存在则建）
- `tests/scripts/publish-soulidity-and-sync.test.ts` — **扩展现有 106 行测试**（已覆盖 8 字段提取 / paymentCoinType fallback / dry-run digest），新增 case：
  1. `extractDeploymentFromPublishResult` 提取 5 个新字段（`marketAdminCapId` / `soulPolicyCapId` / `collectionPolicyCapId` / `soulDisplayId` / `collectionDisplayId`）的 type filter 正确（generic 参数严格匹配，不会误匹其他 TransferPolicyCap）；
  2. transfer PTB 的 6 个对象顺序与多签地址 `normalizeSuiAddress` 校验；
  3. `--resume-cap-transfer-from-manifest`：manifest 已有 publish 字段但缺 `capTransferTxDigest` 时只重发 transfer，不重发 publish；
  4. `Published.toml` 的 `[published.mainnet]` 段写入字段完整且不污染 `[published.testnet]` 段；
  5. mainnet 模式下缺 `MAINNET_DEPLOYER_PRIV_KEY` / 缺 `--transfer-caps-to` / 缺 `--payment-coin-type` 各自的 fail-fast 路径与 exit code（3 = 前置校验失败）。

新增：
- `scripts/lib/keypair.ts` — 抽出共享 `loadKeypairFromEnv(envName)`，batch-publish 与 publish-soulidity 共用
- （cap transfer 集成在现有 publish 脚本内，不新增 npm script）

复用的现有工具：
- `scripts/publish-soulidity-and-sync.ts` 的 `extractDeploymentFromPublishResult`（已能解析 packageId / events / UpgradeCap）— 扩展但不重写。
- `web/lib/soulidity/deployment.ts` 的 `getConfiguredSoulidityNetwork()` / `getSoulidityDeployment()` — 网络切换逻辑无需改动，自动兼容新增的 mainnet key。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| Move.toml 改 mainnet 依赖后无法编译（rev 不匹配 / 缺包） | 先 `sui move build` 跑通再 publish；保留 git 上 testnet 版可回滚 |
| Kiosk package 仍是 testnet `0xc9f6...` | publish 前用 mainnet RPC 断言官方 `<official-mainnet-kiosk-id>` 存在且 owner 为 `Immutable`；web/desktop env 同步 `NEXT_PUBLIC_KIOSK_PACKAGE_ID`；PR / Move.toml 禁止留 `<official-mainnet-kiosk-id>` 占位上线 |
| 主网 USDC 包源在 Circle 仓库结构变动 | 在 PR 描述里 pin 到具体 commit hash；本地编译产物校验 USDC type ID = `0xdba3...::usdc::USDC` |
| publish 成功 + transfer 失败的中间态 | 多签未拿到 cap 但合约已上链，可重跑 transfer-only 模式 / 手动 PTB；写入 manifest 的 `capTransferTxDigest` 为空时主动告警；不要把本方案描述成 atomic handoff |
| 多签地址笔误 | 脚本在 transfer 前用 `normalizeSuiAddress` 校验 32 字节格式；首次跑加 `--dry-run-transfer-only` 选项让 deployer devInspect 一次 PTB 看返回的 effects.gasUsed 与 owner 字段无误 |
| 官方 mainnet kiosk 与当前 vendor sources binary-incompat | step 1 校验 3（disassemble + 函数签名严格比对）必须通过；不通过则回退到自发路径并把自发包 UpgradeCap 入多签 |
| root 脚本找不到 `@mysten/sui` | root `package.json` 增加同版本依赖，不依赖 `NODE_PATH=web/node_modules` |
| TS SDK publish 后 `Published.toml` 没有 mainnet 段 | publish 脚本用 `sui client --client.env mainnet chain-identifier` 和 publish result 显式写 `[published.mainnet]` |
| Desktop hardcoded manifest 漏改导致桌面端连错网 | verification 步骤包含 desktop build smoke |
| `MAINNET_DEPLOYER_PRIV_KEY` 误提交 git | `.env` / `.env.local` 已 gitignore；在 `.husky/pre-commit`（如无则新建）加 `git diff --cached \| grep -E '^\+.*(MAINNET_DEPLOYER_PRIV_KEY=suiprivkey1\|BATCH_SIGNER_SECRET_KEY=suiprivkey1)' && exit 1` 拦截真值；`.env.example` 顶部注释 "**永远不要 commit 真值**" |
| deployer 钱包 gas 不足导致 publish 后 transfer 阶段 OOM | 预检查 deployer 余额 ≥ 1.5 SUI；脚本起步时 `client.getBalance()` 校验，不足则提前退出 |
