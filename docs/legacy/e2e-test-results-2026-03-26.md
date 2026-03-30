# Soul 全流程 E2E 测试结果 — 2026-03-30 (v6 Kiosk Rewrite)

## 架构变更（v6 vs v5）

- **单对象模型**: Soul 直接持有在 Personal Kiosk 中，移除 Series → Release → Pass 层级
- **仅一次性购买**: 移除 subscription/perpetual 双定价，统一为 USDC 定价
- **Personal Kiosk 所有权**: 每个用户需初始化 Personal Kiosk，Soul 通过 kiosk 交易
- **Flat Allowlist**: 每个 Soul 最多一个 allowlist 地址（替代旧 grant 系统）
- **全自动化测试**: Chrome DevTools MCP + CLI 脚本，仅 2 次 Privy OTP 手动输入

## 基础设施

| 组件 | ID |
|------|----|
| soul_object Package | `0x8a14f3c1c35ab5294d50d956eaf5d42bb7e5d146d841b088b71031eee25cb894` |
| soul_market_adapter Package | `0xb25dc3b5dfd30e458dce1a7aea2fabca989413e5004fe0012ead7fb21430165d` |
| MarketConfig | `0x970c26e50caab1629a4f086759cadf349eda4446a940c3a5dff7d02c78251b90` |
| NftMintCap | `0xc0301b7247cae8ea181e21106b82352cfe24d4ccdbf51019c45be54d4e71a72e` |
| NftCollection | `0x7283cced3ae2c01b041eb13c8d2cc489f5b602a1e6a3dd6feb56e702981f26e6` |
| TransferPolicy | `0xf4d1ef60a79f03df8886d9c2f4fdb2c9990e63fd71fe7e9ec17cb95dbbd999d7` |
| AllowlistRegistry | `0xd6c3cb5a1889b91bec16a060dc75a0356bdbeafa6c07e24defe05c4724cf31aa` |
| TestUSDC Package | `0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325` |
| Kiosk Package | `0xc9f6a531d5f4e11ef38dd782c9ab5403fb3c011595384c429285952ff6b31839` |

## 测试账号

| 角色 | 邮箱 | Sui Wallet |
|------|------|------------|
| Seller | ithinco@gmail.com | `0x858dacfa57af771ed53e216acf3409d7485afebb6f68e592fac39ca8e777eb82` |
| Buyer | tenxhunter@gmail.com | `0xb9eda0a8f548da7d3e5f8055e0ea1eb020920d99cd89b5be9788df49f41f614c` |
| Agent Alpha | (API agent) | `0x3b82a2209ab7f937d29c12105fe501a63f4223a7f5c128842d25686e66a68610` |
| Agent Beta | (API agent) | `0x7ef4e29eba6968cd8f255d3533116fd593a71dfb6d23f6e7b03271603c238790` |

## 链上发布的 Soul（v6）

| Soul | On-Chain ID | Pricing | Royalty |
|------|-------------|---------|---------|
| E2E Kiosk Alpha v6 | `0x425fae4efaa5808f3b8c204fe31db5ec2bde70dd1dcb25fa19dc59f43caf1487` | 1 USDC | 5% (500 bps) |
| E2E Kiosk Beta v6 | `0xd1c7bb66561560dec177f772b458e468523152e94173463bf963c89fd9e4b1bf` | 2 USDC | 3% (300 bps) |

## 已通过的测试（28/30）

### Phase 0: Pre-flight

| # | 测试项 | 结果 |
|---|--------|------|
| 0.1 | 页面加载 /souls | ✅ "SOUL MARKET" + "Publish Soul" |
| 0.2 | 页面结构验证 | ✅ 搜索框 + "No Souls listed right now." |
| 0.3 | 截图: 初始列表页 | ✅ `phase0-souls-page.png` |

### Phase 1: Seller 发布

| # | 测试项 | 结果 |
|---|--------|------|
| 1 | Seller Privy 登录 | ✅ ithinco@gmail.com（手动 OTP） |
| 2 | Soul A 发布 — Trading, $1, 5% royalty | ✅ TX `5ecPdyTfV2Fx4YUQWazjFu1sXmZciYm1oECJMKBDsjLv`（draft 恢复成功） |
| 3 | Soul B 发布 — Research, $2, 3% royalty | ✅ |
| 4 | 列表页显示 2 个 Soul | ✅ |
| 5 | My Souls: Authored 2 + Owned 2 | ✅ |
| 6 | Soul A 状态 = Listed | ✅ |
| 7 | Soul B 状态 = Listed | ✅ |

### Phase 2: Buyer 购买

| # | 测试项 | 结果 |
|---|--------|------|
| 8 | Buyer 登录 | ✅ tenxhunter@gmail.com（手动 OTP） |
| 9 | Personal Kiosk 初始化 | ✅ 自动触发，等待 kiosk ready |
| 10 | 购买 Soul A (1.05 USDC 含 fee) | ✅ Status → Held, "You currently own this Soul" |
| 11 | Owner UI 完整 (access + list + allowlist) | ✅ |
| 12 | My Souls: Authored 0 + Owned 1 | ✅ |

### Phase 3: Owner 操作 — Allowlist + Access

| # | 测试项 | 结果 |
|---|--------|------|
| 13 | Set allowlist for Agent Alpha | ✅ UI 显示 "CURRENT ALLOWLIST ADDRESS" |
| 14 | Agent Alpha → Soul A: 200 (allowlisted) | ✅ `seal_approve_allowlisted` |
| 15 | Agent Beta → Soul A: 403 | ✅ |
| 16 | Clear allowlist + handle confirm dialog | ✅ UI 恢复输入态 |
| 17 | Agent Alpha revoked → 403 | ✅ |
| 18 | Re-set allowlist for Alpha | ✅ |
| 19 | Owner download content | ✅ Download 触发，无 console error |

### Phase 4: Agent 自购 + 交叉验证

| # | 测试项 | 结果 |
|---|--------|------|
| 20 | Agent Alpha 自购 Soul B | ✅ TX `4WtXUNe7YmvhkUAECEfYFN5jm2JzLsW6ZiWNURz47qL5` |
| 21 | Alpha → Soul B: 200 (owner) | ✅ `seal_approve_owner_in_personal_kiosk` |
| 22 | 交叉验证: A→A=200, A→B=200, B→A=403, B→B=403 | ✅ |
| 23 | Owner vs Allowlisted policy 差异 | ✅ allowlisted ≠ owner |

### Phase 5: Seal 解密完整性验证

| # | 测试项 | 结果 |
|---|--------|------|
| 24 | Seal 解密 Soul A (allowlisted path) | ⚠️ EncryptedObject.parse 失败（blob 格式兼容性问题） |
| 25 | Seal 解密 Soul B (owner path) | ⏭️ 阻塞于 #24 |

### Phase 6: Hardening 测试

| # | 测试项 | 结果 |
|---|--------|------|
| 26 | Invalid API key → 401 | ✅ |
| 27 | No auth header → 401 | ✅ |
| 28 | Soul not found → 404 | ✅ |
| 29 | No owner/allowlist → 403 | ✅ |
| 30 | Long Soul ID → 404 | ✅ |

## Kiosk Model 验证总结

| 维度 | 验证内容 | 结果 |
|------|----------|------|
| Personal Kiosk | Buyer 和 Agent 都需初始化后才能购买 | ✅ |
| 所有权转移 | 购买后 Soul 移入 Buyer kiosk，Status → Held | ✅ |
| Owner 检测 | `isOwner` 通过 DB member ID + wallet address 匹配 | ✅ |
| Flat Allowlist | 设置/清除单地址 + 版本追踪 | ✅ |
| Access Policy | Owner → `seal_approve_owner_in_personal_kiosk`，Allowlisted → `seal_approve_allowlisted` | ✅ |
| Price Display | 原子 USDC 格式正确（1 USDC, 2 USDC, 1.05 USDC 含 fee） | ✅ |
| Listing Status | 发布时 `listed`，购买后 `held`，列表页只显示 `listed` | ✅ |
| Draft 恢复 | 链上 TX 成功后首次 DB sync 失败，重试恢复成功 | ✅ |

## 修复的问题（v6 测试过程中）

| 问题 | 修复 |
|------|------|
| `readObjectId` 无法解析嵌套 Walrus Blob 对象 | 新增 `readNestedBlobObjectId` 从 `fields.id.id` 提取 |
| Kiosk dynamic field 包装器导致 owner 验证失败 | 新增 `resolveKioskParentId` 追溯 kiosk parent；修复 publish/purchase/allowlist/access 共 6 处 |
| Walrus blob_id u256 decimal 与 base64url 不匹配 | `normalizeWalrusBlobId` 新增 u256→base64url 转换（little-endian） |
| `useSoulDetail` 在 Privy auth 就绪前 fetch 且不 refetch | queryKey 加入 `viewerId` 使 auth 变化后自动 refetch |
| 4 个 pending DB migration 未执行 + 1 个冲突 migration | 清理冲突记录，deploy 4 个 migration |
| MintCap 归部署者钱包，Seller 无法 mint | Transfer MintCap 到 Seller 钱包 |

## 已知问题

| 问题 | 影响 | 状态 |
|------|------|------|
| `EncryptedObject.parse()` 无法解析 Walrus blob | Seal 解密 E2E 脚本无法验证 | 已定位：脚本误把 Walrus 上的 AES-GCM 密文当成 Seal `EncryptedObject`；需改用 `sealSidecar.documentId + encryptedDek` 的 envelope 解密路径后重跑 |

## #24-25 排查结论（2026-03-30）

- 已观察事实：发布链路把内容文件先用 AES-GCM-256 加密后上传到 Walrus；Seal 只用于加密 DEK，并把结果存进 `sealSidecar.encryptedDek`。
- 已观察事实：浏览器下载链路和共享解密实现走的是 `decryptBundle()`，输入为 `Walrus ciphertext + sealSidecar`，不是直接把 Walrus blob 交给 `SealClient.decrypt()`。
- 根因结论：#24 失败不是 Walrus blob 与 Seal SDK 的“格式兼容性问题”，而是 `web/scripts/e2e-agent-decrypt.ts` 仍沿用旧假设，把 Walrus blob 当成 `EncryptedObject` 调 `EncryptedObject.parse()`。
- 收敛路径：更新脚本后，用 `sealSidecar.documentId` 构造 approval tx，用 `sealSidecar.encryptedDek` 走 Seal 解密，再用解出的 DEK 解开 Walrus blob；#25 随之解除阻塞。

## Agent API Keys（测试专用）

| Agent | API Key |
|-------|---------|
| Agent Alpha | `sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f` |
| Agent Beta | `sk-c264016082af57dda7a64f15bb9219f2507d398ac56d66c3` |

## 截图

- `docs/legacy/e2e-screenshots/phase0-souls-page.png` — 初始空列表页
- `docs/legacy/e2e-screenshots/phase1-soul-a-created.png` — Soul A 发布后详情页
- `docs/legacy/e2e-screenshots/phase1-soul-b-created.png` — Soul B 发布后详情页
- `docs/legacy/e2e-screenshots/phase1-all-souls-listed.png` — 2 个 Soul 列表
- `docs/legacy/e2e-screenshots/phase1-my-souls-seller.png` — Seller My Souls
- `docs/legacy/e2e-screenshots/phase2-soul-a-purchased.png` — Buyer 购买后 Owner UI
- `docs/legacy/e2e-screenshots/phase2-my-souls-buyer.png` — Buyer My Souls
- `docs/legacy/e2e-screenshots/phase3-allowlist-set.png` — Allowlist 设置后
- `docs/legacy/e2e-screenshots/phase3-allowlist-cleared.png` — Allowlist 清除后
