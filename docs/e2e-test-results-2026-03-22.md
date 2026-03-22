# Soul 全流程 E2E 测试结果 — 2026-03-22 (v2)

## 基础设施

| 组件 | ID |
|------|----|
| TestUSDC Package | `0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325` |
| TestUSDC TreasuryCap | `0x56033240326fa75ab7986654d87aa3f2c8168212492edc7d7ee4755f30189184` |
| soul_market Package | `0x8827d42c7834878abd4eed7ac124f37d96908c17490e3be45adf9b1ed8ec841e` |
| PlatformConfig | `0x1276dcc0a20f9c8ff3d808bfa44b0a42c6ff3294475daf4bcb1e129c7cbbecd1` |

## 架构变更（v2）

- **去掉 Indexer**：不再使用独立 Sui 事件轮询进程，改为每个链上 TX 成功后直接从 TX result 写 DB
- **post-tx-db.ts**：新建共享 DB 写入函数（upsert 幂等），所有 API 路由共用
- **Publish API**：接受真实 on-chain ID，一次性写 series + release + pricing
- **Purchase API**：从 503 stub 改为实际创建 SoulPassSnapshot
- **Grant API**：从 501 stub 改为实际更新 agentGrant
- **upload-validation**：encrypted 类型不再限制 MIME（任何文件格式都可作为 Soul 内容）

## 测试账号

| 角色 | 邮箱 | Sui Wallet |
|------|------|------------|
| Seller | ithinco@gmail.com | `0x858dacfa57af771ed53e216acf3409d7485afebb6f68e592fac39ca8e777eb82` |
| Buyer | tenxhunter@gmail.com | `0xb9eda0a8f548da7d3e5f8055e0ea1eb020920d99cd89b5be9788df49f41f614c` |
| Agent Alpha | (API agent) | `0x3b82a2209ab7f937d29c12105fe501a63f4223a7f5c128842d25686e66a68610` |
| Agent Beta | (API agent) | `0x7ef4e29eba6968cd8f255d3533116fd593a71dfb6d23f6e7b03271603c238790` |

## 链上发布的 Soul（v2）

| Soul | DB ID | TX |
|------|-------|----|
| E2E Soul Alpha v2 | `e7fa0af7-6648-4b74-b4d3-d9e98ccb3f3e` | `HW4YDZe8X4GPcfGvN6wPW5kGsX4Dg2mfY1fL96s6mKqH` |
| E2E Soul Beta v2 | `624db8e6-ca75-44eb-9a02-ad4363775be1` | `FQdwYSXqZ4KHKK9SwNQJusiv9gD8k2GyCTbmae3DJjGo` |

## 已通过的测试（18/18）

| # | 测试项 | TX / 结果 |
|---|--------|-----------|
| 1 | Seller Privy 登录 | ithinco@gmail.com |
| 2 | 列表页 — 8 分类 + My Souls / Publish 按钮 | OK |
| 3 | Seller 发布 Soul A（链上 series + release + pricing + Seal 加密 + Walrus 上传 → post-TX 写 DB） | `HW4YDZe8...` |
| 4 | Seller 发布 Soul B | `FQdwYSXq...` |
| 5 | DB 直写验证（发布后列表立即显示，无需等 indexer） | OK |
| 6 | Buyer 切换登录 | tenxhunter@gmail.com |
| 7 | Buyer 购买 Soul A（链上 USDC 支付 → post-TX 写 pass DB） | `Fb9c2nvQ...` |
| 8 | My Souls → Purchased tab 显示 Pass (Perpetual) | OK |
| 9 | Agent Grant — 输入地址 + 链上签名 → post-TX 写 agentGrant DB | OK |
| 10 | Agent Alpha 注册（复用旧 member，API key 有效） | OK |
| 11 | Agent Alpha 访问 Soul A → 200 | OK |
| 12 | Buyer 购买 Soul B + Grant Agent Beta | `D9Xh1nxN...` |
| 13 | Agent Beta 访问 Soul B → 200 | OK |
| 14 | 交叉验证（Alpha ✗ B → 403, Beta ✗ A → 403） | OK |
| 15 | Agent Alpha 自购 Soul B | `5Bwzmzpj...` |
| 16 | Agent Beta 自购 Soul A | `9XpAS9Ki...` |
| 17 | 自购后无需 grant 直接访问 → 200 | OK |
| 18 | 全交叉验证（4 组合全 200） | OK |

## Agent API Keys（测试专用）

| Agent | API Key |
|-------|---------|
| Agent Alpha | `sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f` |
| Agent Beta | `sk-c264016082af57dda7a64f15bb9219f2507d398ac56d66c3` |

## 修复的 Bug（v2 测试过程中）

| Bug | 修复 |
|-----|------|
| encrypted 上传拒绝非 binary MIME（如 JSON） | `upload-validation.ts` 移除 MIME 白名单限制 |

## 新增/修改的关键文件（v2）

| 文件 | 变更 |
|------|------|
| `web/lib/souls/post-tx-db.ts` | **新建** — 6 个共享 DB 写入函数（upsert 幂等） |
| `web/app/api/souls/publish/route.ts` | 重写 — 接受真实 on-chain ID |
| `web/app/api/souls/[id]/release/route.ts` | 重写 — 接受真实 releaseOnChainId |
| `web/app/api/souls/[id]/purchase/route.ts` | 重写 — 创建 SoulPassSnapshot（不再 503） |
| `web/app/api/souls/passes/[passId]/grant/route.ts` | 重写 — 写 agentGrant（不再 501） |
| `web/app/api/agent/souls/[id]/purchase/execute/route.ts` | 修改 — TX 后直写 DB |
| `web/app/souls/publish/page.tsx` | 修改 — TX 后调 API 写 DB |
| `web/components/souls/purchase-button.tsx` | 修改 — TX 后调 API 写 pass |
| `web/components/souls/pass-status.tsx` | 修改 — TX 后调 API 更新 grant |
| `web/lib/souls/upload-validation.ts` | 修改 — encrypted 类型不限 MIME |

## 删除的文件

| 文件 | 原因 |
|------|------|
| `web/lib/services/sui-indexer.ts` | Indexer 替换为 post-TX DB writes |
| `web/lib/services/sui-indexer-utils.ts` | Indexer 辅助函数 |
| `web/lib/services/sui-event-decoder.ts` | 事件解码器 |
| `src/indexer/run.ts` | Indexer 入口 |
| `tests/web/sui-indexer-handlers.test.ts` | Indexer 测试 |
| `tests/web/sui-indexer-service.test.ts` | Indexer 测试 |
| `tests/web/sui-event-decoder.test.ts` | 解码器测试 |
| Prisma: `IndexerCursor` model | 不再需要 |
| Prisma: `IndexerDeadLetterEvent` model | 不再需要 |

## 测试套件结果

46 个测试文件，261 个测试，全部通过。

## 截图目录

`/tmp/e2e-test-v2/`
