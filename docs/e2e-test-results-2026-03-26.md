# Soul 全流程 E2E 测试结果 — 2026-03-26 (v5)

## 基础设施

| 组件 | ID |
|------|----|
| TestUSDC Package | `0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325` |
| TestUSDC TreasuryCap | `0x56033240326fa75ab7986654d87aa3f2c8168212492edc7d7ee4755f30189184` |
| soul_market Package | `0xe350ff96e82d56ef4229f2991227632b0cd69748eeb397826ca6582288827a92` |
| PlatformConfig | `0x88715045e61cc3b57d8339e17e1eec20be2d39121ecc68531a1e6489910be20f` |

## 架构变更（v5 vs v4）

- **全自动化测试**：全流程通过 Chrome DevTools MCP + CLI 脚本自动执行，仅 2 次登录需人工输入验证码
- **复用 v4 基础设施**：同一 soul_market 合约、TestUSDC、测试账号和 Agent API Key
- **Draft 恢复验证**：Soul C 发布时触发 draft 恢复流程，重试后成功同步

## 测试账号

| 角色 | 邮箱 | Sui Wallet |
|------|------|------------|
| Seller | ithinco@gmail.com | `0x858dacfa57af771ed53e216acf3409d7485afebb6f68e592fac39ca8e777eb82` |
| Buyer | tenxhunter@gmail.com | `0xb9eda0a8f548da7d3e5f8055e0ea1eb020920d99cd89b5be9788df49f41f614c` |
| Agent Alpha | (API agent) | `0x3b82a2209ab7f937d29c12105fe501a63f4223a7f5c128842d25686e66a68610` |
| Agent Beta | (API agent) | `0x7ef4e29eba6968cd8f255d3533116fd593a71dfb6d23f6e7b03271603c238790` |

## 链上发布的 Soul（v5）

| Soul | DB ID | Pricing | TX |
|------|-------|---------|-----|
| E2E Soul Alpha v5 | `2bb79374-dce6-4660-a45a-480e214b1b31` | One-time $1.00 | `52EADTsmUjkA2UTzZmWS5hnD11PFeBvvECQ4hgFiYaWZ` |
| E2E Soul Beta v5 | `0a79982d-ecc9-4f3e-bb05-b12394616123` | Subscription $1.00/30d | `3NWjeAT5ab9GisVnjysvPVsDfDuEHES1vfaGnoNRwuDR` |
| E2E Soul Gamma v5 | `4900ef9e-626f-4302-bc4a-f43dc9f247df` | Both $1.00 + $1.00/30d | `PLVWrbteDuGcbXHgfoEdZzR8TUQ277nKBe8UxrAyRNn` |

## 已通过的测试（31/31）

### Phase 2: Seller 发布

| # | 测试项 | 结果 |
|---|--------|------|
| 1 | Seller Privy 登录 | ✅ ithinco@gmail.com（已登录状态） |
| 2 | 列表页 — 8 分类 + My Souls / Publish | ✅ |
| 3 | Soul A — one-time $1, Trading, bundle + release | ✅ `52EADTsmUjkA2UTzZmWS5hnD11PFeBvvECQ4hgFiYaWZ` |
| 4 | Soul B — subscription $1/30d, Research, bundle + release | ✅ `3NWjeAT5ab9GisVnjysvPVsDfDuEHES1vfaGnoNRwuDR` |
| 5 | Soul C — both plans, DeFi, bundle + release | ✅ `PLVWrbteDuGcbXHgfoEdZzR8TUQ277nKBe8UxrAyRNn`（draft 恢复重试成功） |
| 6 | DB 直写 — 列表立即显示 3 个 Soul | ✅ |

### Phase 3: Buyer 购买 + Grant

| # | 测试项 | 结果 |
|---|--------|------|
| 7 | Buyer 登录 | ✅ tenxhunter@gmail.com |
| 8 | 购买 Soul A (Perpetual) | ✅ `DaFiWU75CsEjmouNMZuyZdY9BQsC3ZZ8d3fEyXkfVBT1` |
| 9 | 订阅 Soul B (Subscription) | ✅ `DwzrYoGVtwdnbURwsAsnWFxU1NcxC9ryvfm1BeiuRmBX` |
| 10 | 购买 Soul C (Perpetual, both plan) | ✅ `9nrzPYPood25dPU193ri4LdKTTZyCujfizaCr5qC8wBQ` |
| 11 | My Souls — 3 Pass (Perpetual/Active/Perpetual) | ✅ |
| 12 | Grant Agent Alpha → Soul A (perpetual pass) | ✅ |
| 13 | Grant Agent Beta → Soul B (subscription pass) | ✅ |
| 14 | Agent Alpha → Soul A: 200 (perpetual, clockObjectId=null) | ✅ |
| 15 | Agent Beta → Soul B: 200 (subscription, clockObjectId=0x6) | ✅ |
| 16 | 交叉验证: Alpha ✗ B → 403, Beta ✗ A → 403 | ✅ |

### Phase 4: Agent 自购 + 交叉验证

| # | 测试项 | 结果 |
|---|--------|------|
| 17 | Agent Alpha 自购 Soul B (subscription) | ✅ `5eqnf67pwNnv6RCnFSaNWjBEXcrDzvDvhCgBJiReGdZp` |
| 18 | 自购访问 Alpha→B 200 | ✅ |
| 19 | 交叉验证 Alpha→A=200, Alpha→B=200, Beta→B=200, Beta→A=403 | ✅ |
| 20 | Pass type 差异: perpetual→no clock, sub→clock=0x6 | ✅ |

### Phase 5: 新 Release 验证

| # | 测试项 | 结果 |
|---|--------|------|
| 21 | Seller 发布 Soul B v2 release | ✅ |
| 22 | Subscription pass 返回 v2 (latest) | ✅ `version=2.0.0` |
| 23 | Perpetual pass 仍返回 v1 (locked) | ✅ `version=1.0.0` |

### Phase 6: Hardening 测试

| # | 测试项 | 结果 |
|---|--------|------|
| 24 | Invalid API key → 401 | ✅ |
| 25 | No auth header → 401 | ✅ |
| 26 | Soul not found → 404 | ✅ |
| 27 | No pass/grant → 403 | ✅ |
| 28 | Long Soul ID → 400 | ✅ |
| 29 | Wrong planType for Soul → 404 | ✅ |
| 30 | Invalid planType → 400 | ✅ |

### 加密完整性验证

| 验证点 | 验证内容 | 结果 |
|--------|----------|------|
| V1: 原始 hash | 上传前记录 SHA256 | ✅ |
| V3: contentHash 一致 | API 返回 contentHash = 原始 hash | ✅ Alpha=`5929065b...`, Beta v2=`23891f64...` |
| V5: 版本锁定 | Perpetual=v1 hash 不变, Subscription=v2 hash 更新 | ✅ |

## 文件 Hash 记录

| 文件 | SHA256 |
|------|--------|
| Soul A v1 原始 | `5929065b2322508a3fd903e3d166843ef5ed25881e531cd2ce0f79ddf80b507f` |
| Soul B v1 原始 | `f6e31f64e519734c206225dd25a93822b663e862bf946e38ee44430bddb39cbc` |
| Soul B v2 原始 | `23891f641e1e56ac701be8ad74a821dddfa43e43dbaa6ec2628dbdb26c144937` |
| Soul C v1 原始 | `f8c0bc4787af056f84772fce794e92fd23547d4e52b482b765b5743e4924666d` |

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
| 过期 | `expiresAt` null | 有值 (4/25/2026) | ✅ |
| Agent 访问 clockObjectId | `null` | `"0x6"` | ✅ |
| Seal 策略 | `seal_approve_perpetual` | `seal_approve_subscription` | ✅ |
| 新 release 后 | 仍返回 v1 (locked) | 返回 v2 (latest) | ✅ |

## 修复的问题（v5 测试过程中）

| 问题 | 修复 |
|------|------|
| Soul C 首次 DB 同步失败 | Draft 恢复机制自动重试，第二次成功（功能验证通过） |

## 截图

- `docs/e2e-screenshots/phase1-souls-page.png` — 清空后列表页
- `docs/e2e-screenshots/phase2-all-souls-listed.png` — 3 个 Soul 列表
- `docs/e2e-screenshots/phase3-my-souls-purchased.png` — Buyer 购买后 My Souls
- `docs/e2e-screenshots/phase3-grants-complete.png` — 两个 Agent Grant 完成
