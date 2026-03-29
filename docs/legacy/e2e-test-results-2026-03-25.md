# Soul 全流程 E2E 测试结果 — 2026-03-25 (v4)

## 基础设施

| 组件 | ID |
|------|----|
| TestUSDC Package | `0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325` |
| TestUSDC TreasuryCap | `0x56033240326fa75ab7986654d87aa3f2c8168212492edc7d7ee4755f30189184` |
| soul_market Package | `0xe350ff96e82d56ef4229f2991227632b0cd69748eeb397826ca6582288827a92` |
| PlatformConfig | `0x88715045e61cc3b57d8339e17e1eec20be2d39121ecc68531a1e6489910be20f` |

## 架构变更（v4 vs v3）

- **自动化测试**：全流程通过 Chrome DevTools MCP 自动执行，仅登录需人工输入验证码
- **Seal sidecar**：新增 `SOUL_UPLOAD_SECRET` 环境变量 + 3 个 pending migration 应用
- **加密完整性验证**：新增原始文件 hash 对比 + Walrus 加密 blob hash 验证
- **Agent 自购**：通过 `e2e-agent-purchase.ts` 脚本 + Ed25519 本地签名实现自动化

## 测试账号

| 角色 | 邮箱 | Sui Wallet |
|------|------|------------|
| Seller | ithinco@gmail.com | `0x858dacfa57af771ed53e216acf3409d7485afebb6f68e592fac39ca8e777eb82` |
| Buyer | tenxhunter@gmail.com | `0xb9eda0a8f548da7d3e5f8055e0ea1eb020920d99cd89b5be9788df49f41f614c` |
| Agent Alpha | (API agent) | `0x3b82a2209ab7f937d29c12105fe501a63f4223a7f5c128842d25686e66a68610` |
| Agent Beta | (API agent) | `0x7ef4e29eba6968cd8f255d3533116fd593a71dfb6d23f6e7b03271603c238790` |

## 链上发布的 Soul（v4）

| Soul | DB ID | Pricing | TX |
|------|-------|---------|-----|
| E2E Soul Alpha v4 | `0f6564e4-bcdb-41a5-a524-604e2a39b829` | One-time $1.00 | `6hhjKGQraTxGFxgFGne8QX2jW3sZDfAwqXizvWo9mmXv` |
| E2E Soul Beta v4 | `bc474e87-7a66-4d93-8903-20ca454b1e4f` | Subscription $1.00/30d | `2zqiH1A52LBnP2Shq2SneJrKoVWkw2148QEJqKATqrTa` |
| E2E Soul Gamma v4 | `7a6965ba-706b-4737-9d48-391fe1632486` | Both $1.00 + $1.00/30d | `H2w3EqynEyTykpG4w14s1JF1DgLzgAcYdJMJUYg96Rx7` |

## 已通过的测试（29/30）

### Phase 2: Seller 发布

| # | 测试项 | 结果 |
|---|--------|------|
| 1 | Seller Privy 登录 | ✅ ithinco@gmail.com |
| 2 | 列表页 — 8 分类 + My Souls / Publish | ✅ |
| 3 | Soul A — one-time $1, Trading, bundle + release | ✅ |
| 4 | Soul B — subscription $1/30d, Research, bundle + release | ✅ |
| 5 | Soul C — both plans, DeFi, bundle + release | ✅ |
| 6 | DB 直写 — 列表立即显示 3 个 Soul | ✅ |

### Phase 3: Buyer 购买 + Grant

| # | 测试项 | 结果 |
|---|--------|------|
| 7 | Buyer 登录 | ✅ tenxhunter@gmail.com |
| 8 | 购买 Soul A (Perpetual) | ✅ `9mw2HYHWfhiFEBsVHNBj4UCtPyCGJtnAz3b9x6qCJvE4` |
| 9 | 订阅 Soul B (Subscription) | ✅ `3mixqiS7iQkPquCMws8u9o7bRDWGYHzBXwCRQtUGzAiF` |
| 10 | 购买 Soul C (Perpetual, both plan) | ✅ `5Ft6ckGFNNpLCPMzaf51K7CQp9MLu6j47TwAeM64gvCf` |
| 11 | My Souls — 3 Pass (Perpetual/Active/Perpetual) | ✅ |
| 12 | Grant Agent Alpha → Soul A (perpetual pass) | ✅ |
| 13 | Grant Agent Beta → Soul B (subscription pass) | ✅ |
| 14 | Agent Alpha → Soul A: 200 (perpetual, clockObjectId=null) | ✅ |
| 15 | Agent Beta → Soul B: 200 (subscription, clockObjectId=0x6) | ✅ |
| 16 | 交叉验证: Alpha ✗ B → 403, Beta ✗ A → 403 | ✅ |

### Phase 4: Agent 自购 + 交叉验证

| # | 测试项 | 结果 |
|---|--------|------|
| 17 | Agent Alpha 自购 Soul B (subscription) | ✅ `CDJcVjS75SLBWvfGAdrsWdycnBwwXXoVyykUTwzvfubm` |
| 18 | Agent Beta 自购 Soul A (perpetual) | ⏭️ 跳过（无 Beta 助记词） |
| 19 | 自购访问 Alpha→B 200 | ✅ |
| 20 | 交叉验证 Alpha→A=200, Alpha→B=200, Beta→B=200, Beta→A=403 | ✅ |
| 21 | Pass type 差异: perpetual→no clock, sub→clock=0x6 | ✅ |

### Phase 5: 新 Release 验证

| # | 测试项 | 结果 |
|---|--------|------|
| 22 | Seller 发布 Soul B v2 release | ✅ |
| 23 | Subscription pass 返回 v2 (latest) | ✅ `version=2.0.0` |
| 24 | Perpetual pass 仍返回 v1 (locked) | ✅ `version=1.0.0` |

### Phase 6: Hardening 测试

| # | 测试项 | 结果 |
|---|--------|------|
| 25 | Invalid API key → 401 | ✅ |
| 26 | No auth header → 401 | ✅ |
| 27 | Soul not found → 404 | ✅ |
| 28 | No pass/grant → 403 | ✅ |
| 29 | Long Soul ID → 400 | ✅ |
| 30 | Wrong planType for Soul → 404 | ✅ |
| 31 | Invalid planType → 400 | ✅ |

### 加密完整性验证

| 验证点 | 验证内容 | 结果 |
|--------|----------|------|
| V1: 原始 hash | 上传前记录 SHA256 | ✅ |
| V2: 加密确认 | Walrus blob hash ≠ 原始 hash | ✅ 4 blob 全部不同 |
| V3: contentHash 一致 | API 返回 contentHash = 原始 hash | ✅ |
| V5: 版本锁定 | Perpetual=v1 hash 不变, Subscription=v2 hash 更新 | ✅ |

## 文件 Hash 记录

| 文件 | SHA256 |
|------|--------|
| Soul A v1 原始 | `dc9e532523bd90f22dfc0999baf66dd99eb7b66a86bf11088ee3395941de0460` |
| Soul A v1 加密 blob | `f99225f7678445f305f36c64173c3cb64d08ee6f75313d753129cf37bb52d2fc` |
| Soul B v1 原始 | `43e83cadd3c6ed7ed986c520169fb1cc5cd31c223eca41edfbe77050ef56e9e7` |
| Soul B v1 加密 blob | `4cfd1a4698266864b6a0594a0d9d829452177af4ede8c534b1ee37506efc2869` |
| Soul B v2 原始 | `fab60534658859831fa34868ef320fbcce51da502538f28ac769e31a60d09f21` |
| Soul B v2 加密 blob | `40a6335e52724ca108e11998f38a0f19908ada877411079e4887bac9e1dd080e` |
| Soul C v1 原始 | `d04bb5ce44144b4052692f3671087db7266dd886e5847c83b196b3262a393789` |

## Agent API Keys（测试专用）

| Agent | API Key |
|-------|---------|
| Agent Alpha | `sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f` |
| Agent Beta | `sk-c264016082af57dda7a64f15bb9219f2507d398ac56d66c3` |

## One-Time vs Subscription 验证总结

| 维度 | One-Time (Perpetual) | Subscription | 验证 |
|------|---------------------|--------------|------|
| Pass 类型 | `perpetual` | `subscription` | ✅ DB + API |
| Release 绑定 | `lockedReleaseId` 有值 | null | ✅ |
| 过期 | `expiresAt` null | 有值 (4/24/2026) | ✅ |
| Agent 访问 clockObjectId | `null` | `"0x6"` | ✅ |
| Seal 策略 | `seal_approve_perpetual` | `seal_approve_subscription` | ✅ |
| 新 release 后 | 仍返回 v1 (locked) | 返回 v2 (latest) | ✅ |

## 修复的问题（v4 测试过程中）

| 问题 | 修复 |
|------|------|
| `/souls` 404 | 当前跑的是 `next start` (production build)，切换到 `npm run dev` |
| Bundle upload 失败 | 缺少 `SOUL_UPLOAD_SECRET` 环境变量，生成并添加到 `.env` |
| `soulRelease.upsert()` 列不存在 | 3 个 pending Prisma migration 未应用，运行 `prisma migrate deploy` |

## 截图

- `docs/legacy/e2e-screenshots/phase2-souls-list.png` — 列表页初始状态
- `docs/legacy/e2e-screenshots/phase2-soul-a-created.png` — Soul A 创建成功
- `docs/legacy/e2e-screenshots/phase2-all-souls-listed.png` — 3 个 Soul 列表
- `docs/legacy/e2e-screenshots/phase3-my-souls-purchased.png` — Buyer 购买后 My Souls
- `docs/legacy/e2e-screenshots/phase3-grants-complete.png` — 两个 Agent Grant 完成
