# Soul 全流程 E2E 测试结果 — 2026-03-24 (v3)

## 基础设施

| 组件 | ID |
|------|----|
| TestUSDC Package | `0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325` |
| TestUSDC TreasuryCap | `0x56033240326fa75ab7986654d87aa3f2c8168212492edc7d7ee4755f30189184` |
| soul_market Package | `0xe350ff96e82d56ef4229f2991227632b0cd69748eeb397826ca6582288827a92` |
| PlatformConfig | `0x88715045e61cc3b57d8339e17e1eec20be2d39121ecc68531a1e6489910be20f` |

## 架构变更（v3）

- **Release 流程永久启用**：移除所有 disabled 限制，实现完整 bundle 上传 → release 创建 → DB 镜像
- **Release API**：新建 `POST /api/souls/[id]/release`，完整链上验证（TX、作者、包 ID、rate limit、TX-sync 幂等）
- **AuthorCap 自动解析**：release 页面通过 `SuiClient.getOwnedObjects` 自动查找 AuthorCap，无需手动输入
- **客户端 env 修复**：`getRequiredPublicEnv` 改用 switch 字面量访问，兼容 Next.js 编译时替换
- **Prisma 事务超时**：所有 Soul API 路由 `$transaction` 增加 `timeout: 30_000`
- **合约重新部署**：PerpetualPass 从 `key, store` 变为 `key` only（breaking change，新 package）

## 测试账号

| 角色 | 邮箱 | Sui Wallet |
|------|------|------------|
| Seller | ithinco@gmail.com | `0x858dacfa57af771ed53e216acf3409d7485afebb6f68e592fac39ca8e777eb82` |
| Buyer | tenxhunter@gmail.com | `0xb9eda0a8f548da7d3e5f8055e0ea1eb020920d99cd89b5be9788df49f41f614c` |
| Agent Alpha | (API agent) | `0x3b82a2209ab7f937d29c12105fe501a63f4223a7f5c128842d25686e66a68610` |
| Agent Beta | (API agent) | `0x7ef4e29eba6968cd8f255d3533116fd593a71dfb6d23f6e7b03271603c238790` |

## 链上发布的 Soul（v3）

| Soul | DB ID | Pricing | TX |
|------|-------|---------|-----|
| E2E Soul Alpha v3 | `3a84188a-1ed2-44a2-86df-161e76690dc1` | One-time $1.00 | `a4U24gdDNTS28JeXbw7Vkhr7Z9NK4KUUqGBWZKWggDD` |
| E2E Soul Beta v3 | `83a4ac8c-2257-4662-aeb8-62cad49971e1` | Subscription $1.00/30d | `ALvu52B9DBxRBNa4CJ713D57RqiFqZbDrrQxpqC9Juwz` |
| E2E Soul Gamma v3 | `ab4ea46f-7adb-4a2a-bb3a-5e1efbcf0ab9` | Both $1.00 + $1.00/30d | `3styfVHNgDHVjq7Vg1m6uPWNXz77WJhQarUhdqBA94Fy` |

## 已通过的测试（35/35）

### Phase 0: 自动化验证

| # | 测试项 | 结果 |
|---|--------|------|
| 0.1 | Move 单元测试 (79 tests) | ✅ |
| 0.2 | Vitest (74 files, 484 tests) | ✅ |
| 0.3 | Next.js build | ✅ |
| 0.4 | Prisma migrations (40 applied) | ✅ |

### Phase 2: Seller 集中发布

| # | 测试项 | 结果 |
|---|--------|------|
| 1 | Seller Privy 登录 | ✅ ithinco@gmail.com |
| 2 | 列表页 — 8 分类 + My Souls / Publish | ✅ |
| 3 | Soul A — one-time $1, Trading, bundle + release | ✅ |
| 4 | Soul B — subscription $1/30d, Research, bundle + release | ✅ |
| 5 | Soul C — both plans, DeFi, bundle + release | ✅ |
| 6 | DB 直写 — 列表立即显示 3 个 Soul | ✅ |
| 7 | 详情页 — A=Purchase, B=Subscribe+周期, C=两个按钮 | ✅ |

### Phase 3: Buyer 购买 + Grant

| # | 测试项 | 结果 |
|---|--------|------|
| 8 | Buyer 登录 | ✅ tenxhunter@gmail.com |
| 9 | 购买 Soul A (Perpetual) | ✅ `E2mWGoadyqccdDEHyzoD9xun1XUU8iJzcPE8QFQDLspX` |
| 10 | 订阅 Soul B (Subscription) | ✅ `4Vk6atKCEinBjU9bShQ4N9yRogkseSHZGEW8FhPESnvM` |
| 11 | 购买 Soul C (Perpetual, both plan) | ✅ `4BrEKQvKMcZJm3GGErEJ5SGjgLKDsUzVQ7BH4Pq4Jqni` |
| 12 | My Souls — 3 Pass (Perpetual/Active/Perpetual) | ✅ |
| 13 | Grant Agent Alpha → Soul A (perpetual pass) | ✅ |
| 14 | Grant Agent Beta → Soul B (subscription pass) | ✅ |
| 15 | Agent Alpha → Soul A: 200 (perpetual, clockObjectId=null) | ✅ |
| 16 | Agent Beta → Soul B: 200 (subscription, clockObjectId=0x6) | ✅ |
| 17 | 交叉验证: Alpha ✗ B → 403, Beta ✗ A → 403 | ✅ |
| 18 | Agent API key 验证 | ✅ |

### Phase 4: Agent 自购 + 交叉验证

| # | 测试项 | 结果 |
|---|--------|------|
| 19 | Agent Alpha 自购 Soul B (subscription) | ✅ `DJsKwDdx8X2V533tWm2ZkUdCLVoMuDXNDsPdBr8f6x1u` |
| 20 | Agent Beta 自购 Soul A (perpetual) | ✅ `5AR5SnYEGmePj4ZHm3kXovfnXFUfC8fuF2aJSgEYAU2` |
| 21 | 自购访问 Alpha→B 200, Beta→A 200 | ✅ |
| 22 | 全交叉 4×200 | ✅ |
| 23 | Pass type 差异: perpetual→no clock, sub→clock=0x6 | ✅ |

### Phase 5: 新 Release 验证

| # | 测试项 | 结果 |
|---|--------|------|
| 24 | Seller 发布 Soul B v2 release (AuthorCap 自动解析) | ✅ |
| 25 | Subscription pass 返回 v2 (latest) | ✅ `version=2.0.0` |
| 26 | Perpetual pass 仍返回 v1 (locked) | ✅ `version=1.0.0` |

### Phase 6: Hardening 测试

| # | 测试项 | 结果 |
|---|--------|------|
| 27 | 自授权防护 — grant 自己 → abort code 4 | ✅ E_SELF_GRANT |
| 28 | 自转移防护 — transfer 自己 → abort code 3 | ✅ E_SELF_TRANSFER |
| 29 | 零地址 grant → abort code 5 | ✅ E_INVALID_AGENT |
| 30 | 零地址 transfer → abort code 6 | ✅ E_INVALID_RECIPIENT |
| 31 | Grant + 验证 agent 可访问 | ✅ |
| 32 | 幂等 re-grant — 同 agent 重复 grant → 0 events | ✅ |
| 33 | Revoke grant → AgentGrantRevoked event | ✅ |
| 34 | TX-Sync 幂等 — 重试返回缓存结果 | ✅ (Soul B 发布重试验证) |
| 35 | Rate Limiting — 单元测试覆盖 (4 tests) | ✅ |

## Agent API Keys（测试专用）

| Agent | API Key |
|-------|---------|
| Agent Alpha | `sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f` |
| Agent Beta | `sk-c264016082af57dda7a64f15bb9219f2507d398ac56d66c3` |

## 修复的 Bug（v3 测试过程中）

| Bug | 修复 |
|-----|------|
| 客户端 `process.env[name]` 动态访问失败 | `config.ts` 改用 switch 字面量访问 |
| Release TX 在独立交易中创建但 publish API 在 series TX 中查找 | 新增 `releaseTxDigest` 参数 |
| `soul_tx_syncs` CHECK 约束缺少 `'release'` | 新建 migration 添加 |
| Prisma 事务超时（链上 RPC 15-20s） | release route 改用顺序写入，其他路由增加 timeout |
| `web/.env.local` 缺失导致 NEXT_PUBLIC_* 不可用 | 创建 `web/.env.local` 同步根 `.env` |

## 新增/修改的关键文件（v3）

| 文件 | 变更 |
|------|------|
| `web/app/api/souls/[id]/release/route.ts` | **重写** — 完整 POST 实现 |
| `web/app/api/souls/[id]/release/seal/route.ts` | 409→501（Seal 未实现） |
| `web/app/api/souls/upload/route.ts` | 移除 encrypted 类型 409 限制 |
| `web/app/api/souls/publish/route.ts` | 新增 `releaseTxDigest` + 事务超时 |
| `web/app/api/souls/[id]/purchase/route.ts` | 事务超时 |
| `web/app/api/souls/passes/[passId]/grant/route.ts` | 事务超时 |
| `web/app/souls/publish/page.tsx` | 加回 bundle 上传 + release 创建步骤 |
| `web/app/souls/[id]/release/page.tsx` | **重写** — AuthorCap 自动解析 + 完整发布表单 |
| `web/lib/souls/config.ts` | switch 字面量访问 env |
| `web/lib/souls/publish-draft.ts` | 新增 releaseId/releaseTxDigest |
| `web/lib/souls/tx-sync.ts` | 新增 `'release'` 路由键 |
| `move/soul_market/Published.toml` | 新 package 部署记录 |
| `prisma/migrations/20260324130000_*` | 新增 release route_key |

## 测试套件结果

74 个测试文件，484 个测试，全部通过。

## One-Time vs Subscription 验证总结

| 维度 | One-Time (Perpetual) | Subscription | 验证 |
|------|---------------------|--------------|------|
| Pass 类型 | `perpetual` | `subscription` | ✅ DB 字段 |
| Release 绑定 | `lockedReleaseId` 有值 | null | ✅ DB 字段 |
| 过期 | `expiresAt` null | 有值 (4/23/2026) | ✅ DB + UI |
| Agent 访问 clockObjectId | `null` | `"0x6"` | ✅ API 响应 |
| Seal 策略 | `seal_approve_perpetual` | `seal_approve_subscription` | ✅ API 响应 |
| 新 release 后 | 仍返回 v1 (locked) | 返回 v2 (latest) | ✅ Phase 5 |
| 购买按钮 | "Purchase" | "Subscribe" | ✅ UI |
| Both plans Soul | 显示两个按钮，可选 | 显示两个按钮，可选 | ✅ Soul C |
