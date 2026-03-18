# USDC-only 支付简化 + 测试计划

## Context

solana-x402 已合并到 master，原同时支持 SOL 和 USDC 支付。决定**只保留 USDC 稳定币**，移除 SOL 原生代币支付路径。

---

## 第一步：移除 SOL 代码 ✅ (2026-03-18 完成)

### 改动文件

| 文件 | 改动 |
|------|------|
| `web/lib/solana.ts` | 删除 `LAMPORTS_PER_SOL`、`MICROS_PER_USD`、`usdCentsToLamports()`、`ceilDiv()` |
| `web/lib/solana-verify.ts` | 删除 `parseSolTransfer()`、`findMatchingSolTransfer()`，移除 `verifySolanaTransaction()` 的 currency 参数 |
| `web/app/api/market/purchase-intent/route.ts` | 删除 SOL 价格分支，Solana 固定 USDC，始终返回 mint |
| `web/app/api/market/confirm-purchase/route.ts` | 简化 `expectedRecipient`，移除 currency 类型转换 |
| `web/components/market/purchase-button.tsx` | 删除 `solanaCurrency` 状态、SOL 切换 UI、`SystemProgram.transfer` 路径 |
| `web/app/market/my/page.tsx` | 删除 `formatOrderAmount()` 的 `currency === 'SOL'` 分支 |
| `tests/web/solana-payment.test.ts` | 删除 `usdCentsToLamports`、`parseSolTransfer`、SOL verify 测试 |
| `tests/web/purchase-intent-api.test.ts` | 删除 SOL purchase intent 测试 |
| `tests/web/confirm-purchase-api.test.ts` | 移除 verify 调用的第 5 个参数 `'USDC'` |

---

## 第二步：P0 自动化测试 ✅ (2026-03-18 完成)

### 新增测试文件

| 文件 | 测试数 | 覆盖内容 |
|------|--------|----------|
| `tests/web/x402-server.test.ts` | 6 | onAfterSettle → Order+Entitlement、幂等重复、缺失 paymentRequestId、缺失 intent、P2002 唯一约束、非 P2002 异常抛出 |
| `tests/web/download-filename.test.ts` | 7 | 正常名称、NFKC 规范化、路径穿越字符、前导点、空名→fallback、80 字符截断、自定义 fallback |

### 补充用例

| 文件 | +测试数 | 覆盖内容 |
|------|---------|----------|
| `tests/web/confirm-purchase-api.test.ts` | +4 | intent 过期、已确认、金额不足、交易已使用 |
| `tests/web/purchase-intent-api.test.ts` | +3 | 已拥有 bundle、listing 不存在、卖家无钱包 |
| `tests/web/market-publish-api.test.ts` | +2 | 无钱包绑定、CoinGecko 失败→502 |
| `tests/web/coingecko-price.test.ts` | +3 | fetch 失败、响应畸形、并发去重 |

**总计：200 tests passed**

---

## 第三步：P0 手动测试 (待执行)

### 1. 钱包连接与签名（浏览器 + 钱包扩展）

- [ ] Phantom 连接 Solana devnet → WalletMultiButton
- [ ] Sui Wallet 连接 testnet → ConnectButton
- [ ] 签名 challenge → 绑定钱包完整流程

### 2. Solana USDC 链上支付（Devnet）

- [ ] USDC 转账购买完整流程（intent → sign → confirm）
- [ ] USDC 余额不足 → 错误提示
- [ ] 用户拒绝签名 → UI 回退
- [ ] 卖家无 USDC ATA → 错误提示

### 3. 前端 UI

- [ ] `/market` 列表页渲染 + 搜索
- [ ] `/market/[id]` 详情 + 购买按钮（应无 SOL 选项）
- [ ] `/market/my` 已购列表 + 下载
- [ ] Chain 切换 Sui ↔ Solana（currency 固定 USDC/SUI）

### 4. 跨系统集成

- [ ] Supabase Storage 上传 50MB zip → signed URL 下载
- [ ] Prisma migration deploy（staging DB）

---

## 第四步：P1 补充 (待执行)

### P1 自动化测试

| 文件 | 测试项 |
|------|--------|
| `tests/web/solana-payment.test.ts` | RPC 连接失败、签名格式错误、blockTime 缺失 |
| `tests/web/wallet-bind-solana.test.ts` | 签名失败、nonce 过期、cookie 缺失、重复绑定（需先安装 bs58 依赖） |
| `tests/web/agent-download-api.test.ts` | bundle 不存在 |
| `tests/web/agent-api-key-route.test.ts` | 非 human、member 不存在 |
| `tests/web/identity.test.ts` | 多认证路由完整链路 |
| `tests/web/market-download-api.test.ts` (新) | 有权限下载、无权限 403 |
| `tests/web/market-listings-api.test.ts` (新) | 分页、搜索、过滤 |

### P1 手动测试

- [ ] 多钱包切换 → isPrimary 更新
- [ ] Solana Provider 正确加载（layout.tsx）
- [ ] CoinGecko SUI 价格获取 → USD 缓存写入

### P2

- [ ] x402 Facilitator 集成：Agent download → 402 → x402 自动 USDC 支付
- [ ] Facilitator 不可用 → 超时处理
- [ ] Agent marketplace search 空查询、无效参数
- [ ] Agent marketplace listing 详情页

---

## 备注

- `currency` 字段是 String 类型，无 enum 约束，无需 migration
- 已有数据无 SOL 交易记录（功能未上线）
- `wallet-bind-solana.test.ts` 有 pre-existing 的 `bs58` 依赖缺失问题，需 `npm install bs58` 修复
- Solana 端不再调用 `getCoingeckoUsdPrice('solana')`，SUI 端仍需 CoinGecko 做 SUI→USD 转换
