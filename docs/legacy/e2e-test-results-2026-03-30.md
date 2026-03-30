# Soul 全流程 E2E 测试结果 — 2026-03-30 (v6 Kiosk Rewrite, Round 2)

## 架构变更（v6 vs v5）

- **单对象模型**: Soul 直接持有在 Personal Kiosk 中，移除 Series → Release → Pass 层级
- **仅一次性购买**: 移除 subscription/perpetual 双定价，统一为 USDC 定价
- **Personal Kiosk 所有权**: 每个用户需初始化 Personal Kiosk，Soul 通过 kiosk 交易
- **Flat Allowlist**: 每个 Soul 最多一个 allowlist 地址（替代旧 grant 系统）
- **全自动化测试**: Chrome DevTools MCP + CLI 脚本，仅 1 次 Privy OTP 手动输入（Seller 已预登录）

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

## 链上发布的 Soul（v6 Round 2）

| Soul | On-Chain ID | Pricing | Royalty |
|------|-------------|---------|---------|
| E2E Kiosk Alpha v6 | `0xbf753ca154aee4cc3e4619d02c511451bf055f0db3879224e71ac9e4820c07e4` | 1 USDC | 5% (500 bps) |
| E2E Kiosk Beta v6 | `0xec2584c347faf84d65b8a39fc704046316471deeae52da6b4b7889881d75a64b` | 2 USDC | 3% (300 bps) |

## 测试结果：30/30 全通过

### Phase 0: Pre-flight

| # | 测试项 | 结果 |
|---|--------|------|
| 0.1 | 页面加载 /souls | ✅ "SOUL MARKET" + "Publish Soul" |
| 0.2 | 页面结构验证 | ✅ 搜索框 + "No Souls listed right now." |
| 0.3 | 截图: 初始列表页 | ✅ `phase0-souls-page.png` |

### Phase 1: Seller 发布

| # | 测试项 | 结果 |
|---|--------|------|
| 1 | Seller Privy 登录 | ✅ ithinco@gmail.com（预登录） |
| 2 | Soul A 发布 — Trading, $1, 5% royalty | ✅ 自动填表 + Walrus 上传 + Privy 签名 |
| 3 | Soul B 发布 — Research, $2, 3% royalty | ✅ |
| 4 | 列表页显示 2 个 Soul | ✅ |
| 5 | My Souls: Authored 2 + Owned 2 | ✅ |
| 6 | Soul A 状态 = Listed | ✅ |
| 7 | Soul B 状态 = Listed | ✅ |

### Phase 2: Buyer 购买

| # | 测试项 | 结果 |
|---|--------|------|
| 8 | Buyer 登录 | ✅ tenxhunter@gmail.com（手动 OTP） |
| 9 | Personal Kiosk 初始化 | ✅ Kiosk 已就绪，直接显示购买按钮 |
| 10 | 购买 Soul A (1.05 USDC 含 fee) | ✅ Status → Held, "You currently own this Soul" |
| 11 | Owner UI 完整 (access + list + allowlist) | ✅ 三个 section 均存在 |
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
| 20 | Agent Alpha 自购 Soul B | ✅ TX `DUQ1gGFBPpFkJo34aLQaaT3AKEGEEtSfu5bxXfMKDZty` |
| 21 | Alpha → Soul B: 200 (owner) | ✅ `seal_approve_owner_in_personal_kiosk` |
| 22 | 交叉验证: A→A=200, A→B=200, B→A=403, B→B=403 | ✅ |
| 23 | Owner vs Allowlisted policy 差异 | ✅ allowlisted ≠ owner |

### Phase 5: Seal 解密完整性验证

| # | 测试项 | 结果 |
|---|--------|------|
| 24 | Seal 解密 Soul A (owner path, 浏览器) | ✅ Network 验证: sealSidecar 完整, Walrus blob 200, Seal key fetch 200 |
| 25 | Seal 解密 Soul B (owner path, CLI 脚本) | ✅ Content hash 匹配 `86d90ad1...d87de0` |

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
| Personal Kiosk | Buyer kiosk 已就绪，Agent 通过脚本初始化 | ✅ |
| 所有权转移 | 购买后 Soul 移入 Buyer kiosk，Status → Held | ✅ |
| Owner 检测 | `isOwner` 通过 DB member ID + wallet address 匹配 | ✅ |
| Flat Allowlist | 设置/清除单地址 + 版本追踪 | ✅ |
| Access Policy | Owner → `seal_approve_owner_in_personal_kiosk`，Allowlisted → `seal_approve_allowlisted` | ✅ |
| Price Display | 原子 USDC 格式正确（1 USDC, 2 USDC, 1.05 USDC 含 fee） | ✅ |
| Listing Status | 发布时 `listed`，购买后 `held`，列表页只显示 `listed` | ✅ |
| Seal 解密 | DEK envelope 路径正确: Seal 解密 DEK → AES-GCM 解密 Walrus blob | ✅ |

## 上次失败项修复确认

| 问题 | 上次状态 | 本次状态 |
|------|----------|----------|
| #24 Seal 解密 Soul A | ⚠️ EncryptedObject.parse 失败 | ✅ 浏览器 owner path 验证通过 |
| #25 Seal 解密 Soul B | ⏭️ 阻塞于 #24 | ✅ CLI 脚本 hash 匹配，`e2e-agent-decrypt.ts` 已使用正确的 DEK envelope 路径 |

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
