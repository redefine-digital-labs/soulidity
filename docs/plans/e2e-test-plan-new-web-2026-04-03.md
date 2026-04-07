# new-web E2E 自动测试计划 — Soulidity Marketplace

## Context

v6 kiosk rewrite 完成后，new-web (`/new-web/`, Next.js 16 + React 19, port 3100) 替代 legacy `web/` 成为 Soulidity 主前端。需要全流程 E2E 验证新 UI 的 Soul 生命周期：创建 → 上架 → 购买 → Grant 授权 → 访问 → Skills → Memory → 解密。

**与旧 E2E 计划的关键差异：**
- 路由变更：`/souls` → `/market`，`/souls/publish` → `/create`（5 步向导），`/souls/my` → `/my-souls`（5 个 tab）
- 购买/上架有独立页面：`/souls/[id]/buy`，`/souls/[id]/sell` → `/sell/authorize` → `/sell/success`
- Grant 系统替代 Allowlist（`useGrant` hook + `/api/souls/{id}/grant` 端点）
- **Agent API 从 legacy `web/` 迁移到 new-web**，走 Soulidity Grant 体系（而非旧 allowlist）
- 创建向导每步独立 `useState`，不共享跨页面状态 → 实际 publish 需通过 `usePublish` hook

**工具：** Chrome DevTools MCP  
**手动介入：** 仅 2 次 Privy 邮箱 OTP  
**总计：50 项测试，9 个 Phase**

---

## Agent API 迁移方案（已完成 ✅）

> 实现于 2026-04-03，7 个新文件 + 1 个测试文件，1028 tests pass。

### 架构

Agent API 路由在 `new-web/app/api/agent/` 下，通过 `requireAgentWalletIdentity` 中间件认证，走 Soulidity Grant 体系（而非旧 allowlist）。

### Agent API 路由清单

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/agent/souls/search` | GET | 搜索 listed Soul（q, category, limit, offset） |
| `/api/agent/souls/[id]` | GET | Soul 详情 + 购买报价 |
| `/api/agent/souls/[id]/access` | GET | Seal 访问 — owner 或 granted-agent |
| `/api/agent/souls/[id]/purchase` | POST | 准备购买 TX（返回未签名 txBytes + preparedPurchaseId） |
| `/api/agent/souls/[id]/purchase/execute` | POST | 提交签名执行购买 + mirror 同步 |
| `/api/agent/souls/[id]/skills/[versionId]/access` | GET | Skills Seal 访问（public 直读 / private 需 owner 或 skills grant） |

### Auth 中间件

**`new-web/lib/soulidity/agent-server.ts`** — `requireAgentWalletIdentity(request)`:
1. 从 `Authorization: Bearer sk-*` 提取 API key
2. `resolveAgentByApiKey(key)` → `AgentIdentity`（复用 `@web/lib/auth/resolve-agent`）
3. `getMemberSuiWalletAddresses(agentMemberId)` → `string[]`
4. 返回 `{ agent, walletAddresses }` 或 `{ error: NextResponse }`
5. 失败认证按 IP rate limit（60/min）

### Agent 访问流程

```
Agent → /api/agent/souls/{id}/access → requireAgentWalletIdentity
  → resolveSoulAccessPayload(soul, agentWalletAddresses)
  → 自动匹配: owner? → seal_approve_owner
                 activeGrants 含 seal scope? → seal_approve_granted_agent
  → 返回 SoulAccessResponse
```

核心：**Agent 访问 Soul 的前提是 owner 已通过 `useGrant().issueGrant()` 给 agent 钱包地址发放了含 `seal` scope 的 SoulGrant。** 无需额外 allowlist 表。

### Agent 购买流程（两步签名）

```
Step 1: POST /api/agent/souls/{id}/purchase
  → requireAgentWalletIdentity
  → getMarketConfig + quoteSoulPurchase → 报价
  → resolveOwnedPersonalKiosk → buyer kiosk
  → selectCoinObjectIdsForAmountAcrossPages → USDC coins
  → buildBuySoulTx + tx.setSender + tx.build → 序列化 base64
  → 存 SoulPreparedPurchase（10 分钟 TTL）
  → 返回 { preparedPurchaseId, txBytes, context }

Step 2: POST /api/agent/souls/{id}/purchase/execute
  → requireAgentWalletIdentity
  → 验证 preparedPurchase 归属 + 未执行 + 未过期
  → SHA-256 校验 txBytes 完整性
  → suiClient.executeTransactionBlock(txBytes, signature)
  → waitForTransaction → extractSoulPurchasedEvent
  → syncSoulProjectionFromChain + endActiveSoulGrantProjections
  → 缓存结果到 SoulPreparedPurchase + SoulTxSync
  → 返回 { digest, soulOnChainId, currentOwnerAddress, ... }
```

---

## 测试账号

| 角色 | 邮箱 | Wallet |
|------|------|--------|
| Seller | ithinco@gmail.com | `0x858d...eb82` |
| Buyer | tenxhunter@gmail.com | `0xb9ed...614c` |
| Agent Alpha | API key `sk-ea27...4f` | `0x3b82...8610` |
| Agent Beta | API key `sk-c264...c3` | `0x7ef4...8790` |

**运行时变量：** `SOUL_A_ID`（Soul A on-chain ID），`SOUL_B_ID`（Soul B on-chain ID）

---

## Phase -1: 环境准备

### -1.1 清空 DB Soul 数据
```sql
DELETE FROM "soul_grant_records";
DELETE FROM "soul_skill_versions";
DELETE FROM "soul_memory_entries";
DELETE FROM "soul_prepared_purchases";
DELETE FROM "soul_tx_syncs";
DELETE FROM "soul_collection_assets";
DELETE FROM "soul_assets";
```
不清 members / wallet_bindings / agents。

### -1.2 验证测试账号存在
查 DB 确认 Seller/Buyer member + wallet_binding 存在，Agent Alpha/Beta 有 API key。

### -1.3 验证钱包余额
- Seller: ≥0.1 SUI gas
- Buyer: ≥0.1 SUI gas + ≥5 test USDC
- Agent Alpha: ≥0.1 SUI gas + ≥5 test USDC

### -1.4 准备测试文件
- 1x1 PNG（cover image）
- `.md` 文件（Soul character file）
- `.md` 文件（skills version content）

### -1.5 确认 Dev Server 运行
- new-web: `curl http://localhost:3100/market`（确认 HTML 含 "Soulidity"）
- Agent API 已迁移到 new-web，**不再需要 legacy web (port 3000)**

### -1.6 清空浏览器状态
`evaluate_script`: `localStorage.clear(); sessionStorage.clear();`

---

## Phase 0: Pre-flight（3 tests）

### Test 0.1: Landing Page 加载
1. `navigate_page` → `http://localhost:3100`
2. `wait_for` text "Redefine"
3. `evaluate_script` 验证 `a[href="/market"]` 和 `a[href="/create"]` 存在

### Test 0.2: Market 空状态
1. `navigate_page` → `http://localhost:3100/market`
2. `wait_for` text "Soul Market"
3. `evaluate_script` 验证搜索框 `input[placeholder="Search souls, creators, or collections..."]` 存在
4. `evaluate_script` 验证页面含 "No live Soul listings"
5. `evaluate_script` 验证 navbar 有 "Login" 按钮

### Test 0.3: 截图存档
`take_screenshot` → `e2e/phase0-market-empty.png`

---

## Phase 1: Seller 登录 + 发布（12 tests）

### Test 1.1: Seller 登录（手动 OTP #1）
1. `navigate_page` → `http://localhost:3100/market`
2. `click` navbar "Login" 按钮（selector: `button:has-text("Login")`，desktop 视口下在 navbar 右侧）
3. Privy 邮箱 modal 弹出 — 在 Privy iframe 中 `fill` email `ithinco@gmail.com` 并提交
4. **暂停等用户输入 OTP** — `wait_for` AccountButton 出现（selector: navbar 中 `.rounded-full.border.border-border.bg-card2` 按钮），timeout 120s
5. `evaluate_script` 确认 "Login" 按钮不存在
6. `take_screenshot` → `e2e/phase1-seller-login.png`

### Test 1.2: 创建向导 Step 1 — Basic Info
1. `navigate_page` → `http://localhost:3100/create`
2. `wait_for` text "Step 1 — Basic Info"
3. `fill` Soul Name（`input[placeholder="e.g. AlphaScout"]`）: `E2E Soul Alpha NW`
4. `fill` Description（`textarea[placeholder*="What does this Soul do"]`）: `E2E test Soul A — alpha trading strategy content`
5. `fill` Price（`input[placeholder="0.00"][type="number"]`）: `1`
6. `evaluate_script` 验证 "List immediately" 切换按钮默认 ON（按钮 class 含 `bg-[linear-gradient`）
7. `evaluate_script` 验证 "Standard" royalty (5%) 默认选中（按钮 class 含 `border-purple`）

### Test 1.3: 创建向导 Step 2 — Living Content
1. `click` "Next Step →" 链接（`a[href="/create/content"]`）
2. `wait_for` text "Step 2 — Living Content"
3. `click` upload 区域（`button:has-text("Upload Soul Character file")`）→ 模拟上传成功
4. `wait_for` text "soul_character.md uploaded"
5. `fill` Memory（`textarea[placeholder*="founding memory"]`）: `Founding memory for E2E Soul Alpha.`

### Test 1.4: 创建向导 Step 3 — Preview
1. `click` "Awaken this Soul →"（`a[href="/create/preview"]`）
2. `wait_for` text "Step 3 — Soul Awakened"
3. `wait_for` text "My Soul"（预览卡片）
4. `evaluate_script` 验证 info note 含 "live preview"

### Test 1.5: 创建向导 Step 4 — Gas (redirect stub)
1. `click` "Proceed to Pay Gas →"（`a[href="/create/gas"]`）
2. `/create/gas` 是 `redirect('/create')` stub → `wait_for` URL 回到 `/create`
3. `evaluate_script` 验证重新回到 Step 1

> **注意**: 创建向导各步使用独立 `useState`，无跨页面状态共享。向导 Step 4 是 redirect stub，Step 5 是静态 success 页。实际 publish 需通过 `usePublish` hook 在浏览器 context 中触发。

### Test 1.6: Publish Soul A — 通过 usePublish hook（mint + list, $1, 5% royalty）
1. `navigate_page` → `http://localhost:3100/create`（停留在此页提供 React context）
2. `evaluate_script` 执行:
   - 调用 `fetch('/api/souls/upload', ...)` 上传预准备的 content 文件得到 `protectedBlobObjectId`
   - 调用页面 React context 中的 `usePublish().publish({...})` 触发 mint TX
   - 或直接构建 TX: `buildPublishSoulTx(...)` → `signAndExecute()` → `POST /api/souls/publish` 镜像
3. Privy embedded wallet 自动签名
4. `wait_for` publish status 变为 'done'
5. 通过 `evaluate_script` 或 `list_network_requests` 捕获 **SOUL_A_ID**
6. `take_screenshot` → `e2e/phase1-soul-a-published.png`

### Test 1.7: Publish Soul B — mint-only，不上架
同 Test 1.6 流程，参数差异:
- Name: `E2E Soul Beta NW`
- Description: `E2E test Soul B — held, not listed`
- `listForSale: false`（mint 后不调用 `list_fixed_price`）
- Royalty: 3% (300 bps)
- 捕获 **SOUL_B_ID**

### Test 1.8: Soul A 详情页 — Listed 状态
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_A_ID}`
2. `wait_for` text "E2E Soul Alpha NW"
3. `evaluate_script` 验证 hero badge 含 "Listed"
4. `evaluate_script` 验证 CTA 框显示 "Current checkout total" + 价格
5. `evaluate_script` 验证 owner CTA 为 "Manage Listing"（`a[href*="/sell"]`）
6. `evaluate_script` 验证 Protocol State 卡片显示 Soul/State/Memory object ID
7. `evaluate_script` 验证 Access 卡片显示 "Grant capacity: 0 /"

### Test 1.9: Soul B 详情页 — Held 状态
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_B_ID}`
2. `wait_for` text "E2E Soul Beta NW"
3. `evaluate_script` 验证 hero badge 含 "Held"
4. `evaluate_script` 验证 CTA 为 "List Soul"（owner + held → 链接到 `/souls/${SOUL_B_ID}/sell`）
5. `evaluate_script` 验证非 owner 无 Buy 按钮（因为是 owner 视角 + held）

### Test 1.10: Market 显示 1 个 Listed Soul
1. `navigate_page` → `http://localhost:3100/market`
2. `wait_for` text "E2E Soul Alpha NW"
3. `evaluate_script` 验证 Soul B 不显示（market 只显示 `listed` 状态）
4. `evaluate_script` 验证 "No live Soul listings" 不再出现

### Test 1.11: My Souls — Seller Portfolio
1. `navigate_page` → `http://localhost:3100/my-souls`
2. `wait_for` text "My Souls"
3. `evaluate_script` 验证 Owned tab 默认选中，显示 2 个 soul row
4. `click` "Authored" tab → 验证 2 个 soul row
5. `click` "Grant Records" tab → 验证 "No grant records yet"

### Test 1.12: 截图存档
`take_screenshot` → `e2e/phase1-seller-done.png`

---

## Phase 2: 上架 Soul B — 多步 Sell 流程（3 tests）

### Test 2.1: Sell Page — Set Price
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_B_ID}/sell`
2. `wait_for` text "List Soul"
3. `evaluate_script` 验证步骤指示器: "Set Price" 高亮，"Authorize" 灰色
4. `evaluate_script` 验证 Soul 名称 "E2E Soul Beta NW" 显示
5. `fill` price input（`input[type="number"][placeholder="0.00"]`）: `2`
6. `evaluate_script` 验证 "Next: Authorize →" 链接已激活（非 disabled 按钮）

### Test 2.2: Authorize Page — 签名上架 TX
1. `click` "Next: Authorize →"（`a:has-text("Next: Authorize")`）
2. `wait_for` URL 含 `/sell/authorize`
3. `wait_for` text "Authorize listing"
4. `evaluate_script` 验证 Wallet Request 卡片显示: Soul name, Ask price "2.00 USDC", Creator royalty
5. `click` "✓ Sign & List" 按钮（`button:has-text("Sign & List")`）
6. Privy embedded wallet 自动签名 `list_fixed_price` TX
7. `wait_for` URL 变为 `/sell/success`（`useEffect` 在 `status === 'done'` 时 redirect），timeout 60s

### Test 2.3: Sell Success Page
1. `wait_for` text "Soul listed"
2. `evaluate_script` 验证: Soul name + "2.00 USDC" + "Live in kiosk market"
3. `evaluate_script` 验证 "View Market" 和 "My Souls" 链接存在
4. `take_screenshot` → `e2e/phase2-soul-b-listed.png`

---

## Phase 3: Buyer 登录 + 购买（6 tests）

### Test 3.1: Seller 登出
1. `click` navbar AccountButton（`.rounded-full.border.border-border.bg-card2` 按钮）
2. `wait_for` dropdown 出现（含 "Sign Out" 文字）
3. `click` "Sign Out"（`button:has-text("Sign Out")`，红色 `text-danger`）
4. `wait_for` "Login" 按钮重新出现

### Test 3.2: Buyer 登录（手动 OTP #2）
1. `click` "Login"
2. Privy modal 填 `tenxhunter@gmail.com`
3. **暂停等用户输入 OTP** — timeout 120s
4. `wait_for` AccountButton 出现
5. `take_screenshot` → `e2e/phase3-buyer-login.png`

### Test 3.3: Market 显示 2 个 Listed Soul
1. `navigate_page` → `http://localhost:3100/market`
2. `evaluate_script` 验证 "E2E Soul Alpha NW" 和 "E2E Soul Beta NW" 两个 card 均可见

### Test 3.4: Buy Page — 审核 Soul A 报价
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_A_ID}/buy`
2. `wait_for` text "Confirm purchase"
3. `evaluate_script` 验证步骤指示器: Review ✓ → Sign & Sync 高亮
4. `evaluate_script` 验证报价明细:
   - "List price" 行
   - "Protocol fee" 行
   - "Creator royalty" 行
   - "Collection royalty" 行
   - "Total" 行（gold 文字）
5. `evaluate_script` 验证 "Buy for ..." 金色按钮可点击

### Test 3.5: 执行购买 Soul A
1. `click` "Buy for ..." 按钮（`button:has-text("Buy for")`）
2. `wait_for` 按钮文字变为 "⟳ Building TX…" / "⟳ Signing…" / "⟳ Syncing…"
3. Privy embedded wallet 自动签名 `purchase()` TX
4. `wait_for` text "Soul acquired"（success 状态），timeout 60s
5. `evaluate_script` 验证 success 卡片: Soul name + 支付金额 + TX digest
6. `evaluate_script` 验证 "View in My Souls" 链接（`a[href="/my-souls"]`）
7. `take_screenshot` → `e2e/phase3-soul-a-purchased.png`

### Test 3.6: Buyer My Souls — Owned 1
1. `navigate_page` → `http://localhost:3100/my-souls`
2. `evaluate_script` 验证 Owned tab 显示 1 个 soul row（Soul A）
3. `click` "Authored" tab → 验证 "No authored Souls yet"
4. `click` "Granted" tab → 验证 "No granted Souls"

---

## Phase 4: Grant 系统（7 tests）

### Test 4.1: Buyer 查看 Soul A 详情（Owner 视角）
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_A_ID}`
2. `wait_for` text "E2E Soul Alpha NW"
3. `evaluate_script` 验证 hero badge 含 "Held"（购买后从 listed 变 held）
4. `evaluate_script` 验证 Active Grants: "No active SoulGrant is attached to this Soul."
5. `evaluate_script` 验证 owner CTA 为 "List Soul"（owner + held）

### Test 4.2: Issue SoulGrant to Agent Alpha（seal + memory scope）
通过 `evaluate_script` 在浏览器 context 中调用 `useGrant` hook:
1. 构建 `buildIssueGrantTx({ stateObjectId, granteeAddress: '0x3b82...8610', scopeMask: 3 })`（seal=1 | memory=2）
2. `signAndExecute(tx)` → Privy 自动签名
3. `POST /api/souls/${SOUL_A_ID}/grant` 镜像同步
4. 页面 refetch 后验证:
   - Active Grants 区域显示 1 条 grant
   - Grant row 含 Agent Alpha 地址前缀 `0x3b82`
   - Grant scopes 含 "seal" 和 "memory" tag
5. `take_screenshot` → `e2e/phase4-grant-issued.png`

### Test 4.3: Agent Alpha → Soul A: 200（granted-agent via new-web）
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```
验证:
- HTTP 200
- `accessKind` = `"granted-agent"`
- `accessPolicy.functionName` = `"seal_approve_granted_agent"`
- `accessPolicy.soulGrantObjectId` 非空（指向链上 SoulGrant 对象）

### Test 4.4: Agent Beta → Soul A: 403（无 Grant）
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer sk-c264016082af57dda7a64f15bb9219f2507d398ac56d66c3" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```
验证 HTTP 403 + `"Only the owner or the active granted agent can access this Soul"`

### Test 4.5: My Souls — Grant Records tab
1. `navigate_page` → `http://localhost:3100/my-souls`
2. `click` "Grant Records" tab
3. `evaluate_script` 验证至少 1 条 grant record
4. `evaluate_script` 验证 grant row 含 "active" status tag + "seal"/"memory" scope tags

### Test 4.6: Revoke SoulGrant
在 Soul A 详情页通过 `evaluate_script` 调用 `useGrant().revokeGrant('0x3b82...')`:
1. `signAndExecute(buildRevokeGrantTx(...))` → Privy 自动签名
2. `POST /api/souls/${SOUL_A_ID}/grant` 镜像 revoke
3. 验证 Active Grants 恢复 "No active SoulGrant"
4. `take_screenshot`

### Test 4.7: Agent Alpha revoked → 403（Grant 已撤销）
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```
验证 HTTP 403

---

## Phase 5: Skills & Memory（4 tests）

### Test 5.1: Skills Panel 初始状态
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_A_ID}`
2. 定位 Skills 面板（`SkillsPanel` 组件）
3. `evaluate_script` 验证显示 owner 级别操作（Buyer 是 owner）

### Test 5.2: Append Skills Version
1. 在 Skills 面板中上传准备好的 `.md` skills 文件
2. `click` "Append Version" 按钮
3. Privy 自动签名 `append_version_as_owner()` TX
4. `wait_for` 新 skill version row 出现
5. `evaluate_script` 验证 version row 含 "private" tag + blob 地址

### Test 5.3: Memory Entry Append
1. 通过 `evaluate_script` 构建 `append_as_owner()` memory TX
2. Privy 自动签名 → `POST /api/souls/${SOUL_A_ID}/memory` 镜像
3. 刷新详情页 → `evaluate_script` 验证 "Recent Memory" 含 entry row
4. 验证 entry row 含 entry index "#0" + writer kind "owner"

### Test 5.4: Owner Decrypt Skills Version
1. 在 skill version row 点击 "Decrypt" 按钮
2. Privy 签名 Seal personal message
3. `wait_for` 按钮从 loading 恢复
4. `list_console_messages` 验证无 error

---

## Phase 6: Agent API 功能验证（6 tests）

> 全部走 new-web Agent API（port 3100），不依赖 legacy web。

### Test 6.1: Agent Soul Search
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f" \
  "http://localhost:3100/api/agent/souls/search?q=E2E&limit=10"
```
验证:
- HTTP 200
- `items` 数组含 Soul B（listed 状态）
- 每个 item 含 `onChainId`, `name`, `listedPriceAtomic`, `listingStatus`

### Test 6.2: Agent Soul Detail
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f" \
  http://localhost:3100/api/agent/souls/${SOUL_B_ID}
```
验证 HTTP 200 + response 含 Soul B 完整信息（name, description, listingStatus=listed, listedPriceAtomic）

### Test 6.3: Agent Alpha 购买 Soul B（两步签名）
**Step 1 — 准备 TX：**
```bash
curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Bearer sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f" \
  -H "Content-Type: application/json" \
  -d '{}' \
  http://localhost:3100/api/agent/souls/${SOUL_B_ID}/purchase
```
验证 HTTP 200 + 捕获 `preparedPurchaseId` 和 `txBytes`（base64）

**Step 2 — 签名执行：**
使用 Agent Alpha 的 Ed25519 keypair（从 `AGENT_MNEMONIC` 派生）对 `txBytes` 签名:
```bash
# 由 e2e-agent-purchase.ts 脚本执行签名 + 调用 execute
cd /Users/admin/Desktop/nao/clawnews && \
SOUL_ID=${SOUL_B_ID} \
AGENT_API_KEY=sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f \
AGENT_MNEMONIC="..." \
BASE_URL=http://localhost:3100 \
npx tsx new-web/scripts/e2e-agent-purchase.ts
```
验证退出码 0 + 输出含 TX digest + `listingStatus: "held"`

### Test 6.4: Agent Alpha → Soul B: 200（owner）
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f" \
  http://localhost:3100/api/agent/souls/${SOUL_B_ID}/access
```
验证:
- HTTP 200
- `accessKind` = `"owner"`
- `accessPolicy.functionName` = `"seal_approve_owner"`

### Test 6.5: 交叉验证矩阵（全走 new-web）
4 个 curl 均走 `localhost:3100`:

| Agent | Soul A | Soul B |
|-------|--------|--------|
| Alpha | 403 (grant revoked in Phase 4) | 200 (owner) |
| Beta  | 403 (无 grant) | 403 (非 owner) |

```bash
# Alpha → Soul A
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
# → 403

# Alpha → Soul B
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f" \
  http://localhost:3100/api/agent/souls/${SOUL_B_ID}/access
# → 200

# Beta → Soul A
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer sk-c264016082af57dda7a64f15bb9219f2507d398ac56d66c3" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
# → 403

# Beta → Soul B
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer sk-c264016082af57dda7a64f15bb9219f2507d398ac56d66c3" \
  http://localhost:3100/api/agent/souls/${SOUL_B_ID}/access
# → 403
```

### Test 6.6: Agent Seal Decrypt Soul B
```bash
SOUL_ID=${SOUL_B_ID} \
AGENT_API_KEY=sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f \
AGENT_MNEMONIC="..." \
BASE_URL=http://localhost:3100 \
npx tsx new-web/scripts/e2e-agent-decrypt.ts
```
验证:
- 解密成功（退出码 0）
- Seal 调用 `seal_approve_owner`（Agent Alpha 是 owner）
- 输出 content hash 匹配

---

## Phase 7: API 边界 & Hardening（6 tests）

> 全部走 new-web（port 3100）。

### Test 7.1: Invalid API key → 401
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer sk-invalid-000000" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```

### Test 7.2: No auth header → 401
```bash
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```

### Test 7.3: Non-sk token → 401
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer eyJhbGciOiJFZERTQSJ9.fake.jwt" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```
验证 Agent API 只接受 `sk-` 前缀 token

### Test 7.4: Soul not found → 404
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f" \
  http://localhost:3100/api/agent/souls/0x0000000000000000000000000000000000000000000000000000000000000000/access
```

### Test 7.5: No permission → 403
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer sk-c264016082af57dda7a64f15bb9219f2507d398ac56d66c3" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```

### Test 7.6: Public Soul 详情 API → 404（不存在的 Soul）
```bash
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3100/api/souls/0x0000000000000000000000000000000000000000000000000000000000000000
```

---

## Phase 8: 新功能页面渲染（3 tests）

### Test 8.1: Community Page
1. `navigate_page` → `http://localhost:3100/community`
2. `wait_for` text "Soul Feed"
3. `evaluate_script` 验证 mock posts 渲染（至少 4 篇 article）
4. `evaluate_script` 验证 "Top Souls" leaderboard sidebar 存在
5. `evaluate_script` 验证 filter tabs 存在（LIVE, New, Top, Discussed, Random）

### Test 8.2: Import Page
1. `navigate_page` → `http://localhost:3100/import`
2. `wait_for` text "Step 1"
3. `evaluate_script` 验证 source 选项存在（Character.AI, NovelAI, Custom JSON, Other）

### Test 8.3: Wrap + Link Page
1. `navigate_page` → `http://localhost:3100/wrap-link`
2. `wait_for` text "Wrap + Link"
3. `evaluate_script` 验证 Personal Join 和 Collection Expand 两个入口 card 存在

---

## 手动介入点（仅 2 次）

1. **Test 1.1** — Seller OTP（`ithinco@gmail.com`）
2. **Test 3.2** — Buyer OTP（`tenxhunter@gmail.com`）

Privy embedded wallet 签名全自动。

---

## 状态依赖链

```
Phase -1 (cleanup) → Phase 0 (pre-flight)
Test 1.1 (seller login) → Tests 1.2-1.12
Test 1.6 (publish Soul A, listed) → SOUL_A_ID → 所有后续
Test 1.7 (publish Soul B, held) → SOUL_B_ID → Phase 2+
Phase 2 (list Soul B) → Soul B 变 listed → Phase 3
Test 3.1 (seller logout) → Test 3.2 (buyer login)
Test 3.5 (purchase Soul A) → buyer owns Soul A → Phase 4+
Test 4.2 (issue grant to Alpha) → Tests 4.3-4.5
Test 4.6 (revoke grant) → Test 4.7
Phase 5 (skills/memory) ← buyer 仍登录 + owns Soul A
Test 6.1-6.2 (agent search + detail) → 独立只读
Test 6.3 (agent purchase Soul B) → Tests 6.4-6.6
Phase 7 (API boundary) → 独立于浏览器状态
Phase 8 (new feature pages) → 独立
```

---

## 测试数量汇总

| Phase | Tests | 描述 |
|-------|-------|------|
| 0 | 3 | Pre-flight 冒烟 |
| 1 | 12 | Seller 登录 + Soul 创建 + 验证 |
| 2 | 3 | 多步 Sell 上架流程 |
| 3 | 6 | Buyer 登录 + 购买流程 |
| 4 | 7 | Grant 发放 / 验证 / 撤销（含 Agent access 验证） |
| 5 | 4 | Skills append + Memory + 解密 |
| 6 | 6 | Agent API 全流程（search → detail → purchase → access → decrypt） |
| 7 | 6 | API 边界测试（401/403/404） |
| 8 | 3 | 新功能页面渲染 |
| **Total** | **50** | |

---

## 关键 Selectors 速查

| 元素 | Selector | 页面 |
|------|----------|------|
| Login | `button:has-text("Login")` | Navbar |
| AccountButton | `.rounded-full.border.border-border.bg-card2` | Navbar |
| Sign Out | `button:has-text("Sign Out")` (text-danger) | AccountButton dropdown |
| Search 框 | `input[placeholder="Search souls, creators, or collections..."]` | /market |
| Soul Name | `input[placeholder="e.g. AlphaScout"]` | /create |
| Description | `textarea[placeholder*="What does this Soul do"]` | /create |
| Price | `input[placeholder="0.00"][type="number"]` | /create, /sell |
| List toggle | `.relative.h-8.w-14.rounded-full` | /create |
| Royalty Standard | `button:has-text("Standard")` | /create |
| Next Step | `a[href="/create/content"]` | /create |
| Upload Character | `button:has-text("Upload Soul Character file")` | /create/content |
| Memory | `textarea[placeholder*="founding memory"]` | /create/content |
| Buy button | `button:has-text("Buy for")` | /souls/{id}/buy |
| Sign & List | `button:has-text("Sign & List")` | /souls/{id}/sell/authorize |
| Next: Authorize | `a:has-text("Next: Authorize")` | /souls/{id}/sell |
| Owned tab | `button:has-text("Owned")` | /my-souls |
| Authored tab | `button:has-text("Authored")` | /my-souls |
| Granted tab | `button:has-text("Granted")` | /my-souls |
| Grant Records tab | `button:has-text("Grant Records")` | /my-souls |
| Manage Listing | `a:has-text("Manage Listing")` | /souls/{id} (owner+listed) |
| List Soul | `a:has-text("List Soul")` | /souls/{id} (owner+held) |

---

## 关键文件

### 前端页面
| 文件 | 用途 |
|------|------|
| `new-web/app/market/page.tsx` | Market 列表页 — Phase 0, 1.10, 3.3 |
| `new-web/app/souls/[id]/page.tsx` | Soul 详情页 — Phase 1.8-1.9, 4.1-4.6, 5 |
| `new-web/app/souls/[id]/buy/page.tsx` | Buy 页 — Phase 3.4-3.5 |
| `new-web/app/souls/[id]/sell/page.tsx` | Sell 设价页 — Phase 2.1 |
| `new-web/app/souls/[id]/sell/authorize/page.tsx` | Sell 签名页 — Phase 2.2 |
| `new-web/app/souls/[id]/sell/success/page.tsx` | Sell 成功页 — Phase 2.3 |
| `new-web/app/create/page.tsx` | 创建 Step 1 — Phase 1.2 |
| `new-web/app/create/content/page.tsx` | 创建 Step 2 — Phase 1.3 |
| `new-web/app/create/preview/page.tsx` | 创建 Step 3 — Phase 1.4 |
| `new-web/app/my-souls/page.tsx` | My Souls 5-tab — Phase 1.11, 3.6, 4.5 |
| `new-web/components/nav/navbar.tsx` | 导航栏 + Login |
| `new-web/components/nav/account-button.tsx` | 账户下拉 + Sign Out |
| `new-web/components/providers/auth-provider.tsx` | Privy auth context |

### 前端 Hooks
| 文件 | 用途 |
|------|------|
| `new-web/lib/hooks/use-publish.ts` | Publish hook — Phase 1.6-1.7 |
| `new-web/lib/hooks/use-purchase.ts` | Purchase hook — Phase 3.5 |
| `new-web/lib/hooks/use-list-soul.ts` | List hook — Phase 2.2 |
| `new-web/lib/hooks/use-grant.ts` | Grant hook — Phase 4.2, 4.6 |
| `new-web/lib/hooks/use-skills.ts` | Skills hook — Phase 5 |
| `new-web/components/souls/skills-panel.tsx` | Skills 面板 UI — Phase 5 |

### Agent API（已实现 ✅）
| 文件 | 用途 |
|------|------|
| `new-web/lib/soulidity/agent-server.ts` | Agent auth 中间件 `requireAgentWalletIdentity` |
| `new-web/lib/soulidity/coin-selection.ts` | Coin 选择工具（独立于 legacy，满足 repo 隔离约束） |
| `new-web/app/api/agent/souls/search/route.ts` | Agent 搜索 listed Soul |
| `new-web/app/api/agent/souls/[id]/route.ts` | Agent Soul 详情 + 报价 |
| `new-web/app/api/agent/souls/[id]/access/route.ts` | Agent Seal 访问（复用 `resolveSoulAccessPayload`） |
| `new-web/app/api/agent/souls/[id]/purchase/route.ts` | Agent 准备购买 TX（deferred signing） |
| `new-web/app/api/agent/souls/[id]/purchase/execute/route.ts` | Agent 执行购买 TX + mirror 同步 |
| `new-web/app/api/agent/souls/[id]/skills/[versionId]/access/route.ts` | Agent Skills Seal 访问 |
| `tests/new-web/soulidity-agent-server.test.ts` | Auth 中间件单元测试（7 tests） |

### E2E 脚本（已实现 ✅）
| 文件 | 用途 |
|------|------|
| `new-web/scripts/e2e-agent-purchase.ts` | Agent 购买（prepare → local sign → execute → verify access） |
| `new-web/scripts/e2e-agent-decrypt.ts` | Agent Seal 解密（Soulidity `seal_approve_owner` / `seal_approve_granted_agent`） |

### 复用的 Soulidity SDK
| 文件 | 用途 |
|------|------|
| `new-web/lib/soulidity/access.ts` | Seal 访问逻辑（`resolveSoulAccessPayload`，支持 `owner` + `granted-agent`） |
| `new-web/lib/soulidity/repository.ts` | Soul 查询 + 序列化（`findSoulAssetDetailByRouteId`, `toSoulAssetDetail`） |
| `new-web/lib/soulidity/queries.ts` | 链上读取 + 报价（`getMarketConfig`, `quoteSoulPurchase`） |
| `new-web/lib/soulidity/tx/buy.ts` | 购买 TX builder（`buildBuySoulTx`） |
| `new-web/lib/soulidity/personal-kiosk.ts` | Personal kiosk 解析（`resolveOwnedPersonalKiosk`） |
| `new-web/lib/soulidity/mirror/` | Post-TX DB 镜像同步 |
| `new-web/lib/soulidity/events.ts` | TX 事件提取（`extractSoulPurchasedEvent`） |
| `new-web/lib/soulidity/server.ts` | Human auth（`requireHumanWalletIdentity`，Agent API 不用这个） |
| `new-web/lib/soulidity/env.ts` | Soulidity 环境变量 |

### 复用的 Legacy Auth（通过 `@web/*` alias 引用）
| 文件 | 用途 |
|------|------|
| `web/lib/auth/resolve-agent.ts` | `resolveAgentByApiKey` — API key SHA-256 → AgentIdentity |
| `web/lib/auth/sui-wallet.ts` | `getMemberSuiWalletAddresses` — Agent 钱包解析 |
| `web/lib/rate-limit.ts` | `takeRateLimitToken` — IP/member rate limiting |
| `web/lib/sui.ts` | `suiClient` — Sui RPC 客户端 |
| `web/lib/prisma.ts` | `prisma` — 共享 Prisma 客户端 |

---

## 已知风险与缓解

1. **创建向导状态隔离**: 各步独立 `useState`，`/create/gas` 是 redirect stub → 测试分两层：UI 渲染验证 (Tests 1.2-1.5) + `usePublish` hook 触发实际 publish (Tests 1.6-1.7)
2. ~~**Agent API 需先实现再测试**~~ → **已完成**（2026-04-03），6 个路由 + auth 中间件 + 7 项单元测试，1028 tests pass
3. **Privy iframe selectors**: Privy 注入自己的 iframe，内部 selector 需运行时通过 `evaluate_script` 查询
4. **Rate limit**: 本地 dev 用内存 rate limiter，正常测试不触发
5. ~~**Agent auth 复用 legacy 代码**~~ → **已验证可用**：`@web/lib/auth/resolve-agent` 等通过 `@web/*` alias 正常导入，test suite 全绿
6. **Coin selection 隔离约束**: `web/lib/souls/coin-selection.ts` 不可在 new-web 中直接引用（repo contract 禁止 `@web/lib/souls/*`），已复制为独立的 `new-web/lib/soulidity/coin-selection.ts`
7. **Agent 购买两步签名 TTL**: prepare 到 execute 之间有 10 分钟窗口，超时后 `SoulPreparedPurchase.expiresAt` 校验返回 410
8. ~~**E2E 脚本待创建**~~ → **已完成**：`new-web/scripts/e2e-agent-purchase.ts`（两步签名，服务端建 TX）和 `e2e-agent-decrypt.ts`（内联 Seal 工具，支持 `seal_approve_owner` + `seal_approve_granted_agent`）

---

## 验证标准

全部 50 项测试通过，截图存档到 `docs/e2e-screenshots/`，测试结果更新到 `docs/e2e-test-results-new-web.md`。
