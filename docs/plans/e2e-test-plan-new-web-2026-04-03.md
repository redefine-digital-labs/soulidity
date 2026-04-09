# new-web E2E 全自动测试计划 — Soulidity Marketplace

## Context

v6 kiosk rewrite 完成后，new-web (`/new-web/`, Next.js 16 + React 19, port 3100) 替代 legacy `web/` 成为 Soulidity 主前端。需要全流程 E2E 验证新 UI 的 Soul 生命周期：创建 → 上架 → 购买 → Grant 授权 → 访问 → Skills → Memory → 解密，以及 Collection 创建和 Import 流程。

**全自动执行：** 本计划设计为 AI agent 独立可执行，零人工判断。自动化覆盖：
- **浏览器交互** — Chrome DevTools MCP（snapshot → uid → click/fill/upload）
- **链上状态发现 + USDC mint** — `sui client` CLI（balance / objects / call）
- **API + DB 验证** — `curl` / SQL / `npx tsx` 脚本
- **TX 签名** — Privy embedded wallet 自动签名（所有链上交易）

**唯一人工介入：** 2 次 Privy 邮箱 OTP（执行者仅需输入 6 位验证码，其余全部自动化）
**测试 Fixture：** `/Users/admin/Documents/example`（单 Soul）+ `/Users/admin/Documents/example-collection`（Collection）
**总计：74 个测试项（72 项主流程 + 1 项外部依赖验证 + 1 项白盒附加验证），11 个 Phase**

---

## 执行约束（全自动 + Chrome DevTools MCP）

### 全自动执行原则

本计划的设计目标是**零人工判断执行**。除 Privy OTP 外，所有步骤均可由 AI agent 独立完成：

| 操作类型 | 自动化方式 | 人工介入 |
|----------|-----------|---------|
| 浏览器交互 | Chrome DevTools MCP（snapshot → uid → click/fill/upload） | 无 |
| 链上状态发现 | `sui client balance` / `sui client objects` / `sui client gas` | 无 |
| 测试 USDC 补给 | `sui client call --module usdc --function mint`（testnet 发布包） | 无 |
| SUI Gas 补给 | `sui client faucet`（testnet） | 无 |
| TX 签名 | Privy embedded wallet 自动签名 | 无 |
| Agent API 调用 | `curl` + `npx tsx` 脚本 | 无 |
| DB 验证 | SQL 查询 | 无 |
| Privy 登录 OTP | `wait_for` 暂停 120s | **用户输入 6 位验证码** |

**失败自动处理：** 每步有明确 pass/fail 判据；失败时自动 `take_screenshot` 存档后继续或中止。

### 浏览器步骤必须落到 MCP 原语

- 导航：`new_page` / `navigate_page`
- 定位：先 `take_snapshot`，基于最新 snapshot 的 `uid` 找元素
- 点击：`click(uid)`
- 输入：`fill(uid, value)` 或 `type_text`
- 上传：`upload_file(uid, filePath)`
- 断言：`wait_for` + `evaluate_script`
- 截图：`take_screenshot`

### 文档中的 selector 只是定位提示，不是直接命令

- 文中的 `button:has-text("...")`、`input[...]`、`selector: ...`、`a[href="..."]` 仅用于帮助执行者在 snapshot / DOM 中定位目标。
- 执行时不要把这些字符串直接当作 Chrome DevTools MCP 参数；必须先刷新 snapshot，再用对应 `uid` 调 `click` / `fill` / `upload_file`。
- 每次页面跳转、modal 打开、toast 消失、列表刷新、iframe 重绘后，都要重新 `take_snapshot`，不要复用旧 `uid`。

### 终端步骤的边界

- 本文中的 `curl`、SQL、`npx tsx` 只用于 API 边界、链路校验和辅助脚本，不替代浏览器侧的 Chrome DevTools MCP 流程。
- 主流程通过口径以浏览器链路 + 必要 API 校验为准；白盒脚本和外部依赖脚本单独标记，不混入主流程通过数。

### 一条浏览器步骤的标准翻译

文档写法：

```text
click "Login" 按钮（button:has-text("Login")）
```

实际执行：

```text
1. take_snapshot
2. 在 snapshot 中找到文本为 "Login" 的按钮 uid
3. click(uid)
```

文件上传同理：先 `take_snapshot` 找到 file input 的 `uid`，再 `upload_file(uid, filePath)`。

---

## 测试 Fixture

### 单 Soul — `/Users/admin/Documents/example/`

| 文件 | 大小 | 用途 |
|------|------|------|
| `soul.md` | 1K | Soul Character 文件（memory management template） |
| `memory.md` | 1K | Founding Memory 文件 |
| `images.jpeg` | 4.8K, 225×225 JPEG | Cover 图片 |
| `skill.zip` | 5.6K, ZIP 含 SKILL.md frontmatter | Skills Bundle |

### Collection — `/Users/admin/Documents/example-collection/`

| 文件 | 大小 | 用途 |
|------|------|------|
| `soul-collection-template.xlsx` | 6.2K | Collection 元数据模板（Soul Name, Description, Category, Tags, Royalty） |
| `1/soul.md` | 1K | 子文件夹 Soul Character |
| `1/memory.md` | 1K | 子文件夹 Memory |
| `1/images.jpeg` | 4.8K | 子文件夹 Cover |
| `1/skill.zip` | 5.6K | 子文件夹 Skills |

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
| `/api/agent/souls/[id]/skills/[skillName]/versions/[versionIndex]/access` | GET | Skills Seal 访问 |
| `/api/agent/souls/[id]/memory/[entryKey]/access` | GET | Memory Seal 访问 |

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

### 角色定义（地址通过 Sui CLI 动态发现，不硬编码）

| 角色 | 认证方式 | 钱包发现方式 |
|------|---------|------------|
| Seller | Privy 邮箱 `$E2E_SELLER_EMAIL` | DB `wallet_bindings` → `sui client balance` 验证 |
| Buyer | Privy 邮箱 `$E2E_BUYER_EMAIL` | DB `wallet_bindings` → `sui client balance` 验证 |
| Agent Alpha | API key `$E2E_AGENT_ALPHA_API_KEY` | DB `wallet_bindings` → `sui client balance` 验证 |
| Agent Beta | API key `$E2E_AGENT_BETA_API_KEY` | DB `wallet_bindings` → `sui client balance` 验证 |

### Sui CLI 速查（地址发现 + 余额检查 + USDC mint）

> 前提：`sui client active-env` = testnet，`sui --version` >= 1.69.0

| 命令 | 用途 |
|------|------|
| `sui client active-address` | 当前活跃地址（USDC mint 需为 Treasury Cap owner） |
| `sui client balance <addr>` | 全币种余额 |
| `sui client balance --coin-type "0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325::usdc::USDC" <addr>` | USDC 余额 |
| `sui client gas <addr>` | SUI gas coin 列表 |
| `sui client objects <addr>` | 所有拥有的对象（含 kiosk、Soul 等） |
| `sui client faucet --address <addr>` | 为地址申请 testnet SUI gas |

### USDC 测试网包（自动 mint 用）

| 属性 | 值 |
|------|---|
| Package | `0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325` |
| Module | `usdc` |
| Coin Type | `0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325::usdc::USDC` |
| Treasury Cap | `0x56033240326fa75ab7986654d87aa3f2c8168212492edc7d7ee4755f30189184` |
| Treasury Owner | `0x76fd52cac79bda80806be6b5ab7f3b1f099a966203cce809254919a7ab755728` |
| Decimals | 6（1 USDC = 1,000,000 atomic units） |

**Mint 命令模板：**
```bash
sui client call \
  --package 0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325 \
  --module usdc --function mint \
  --args 0x56033240326fa75ab7986654d87aa3f2c8168212492edc7d7ee4755f30189184 \
         <AMOUNT_ATOMIC> <RECIPIENT_ADDR> \
  --gas-budget 10000000
```

**敏感变量（仅本地 shell / direnv 注入，不写入仓库）：**
- `E2E_SELLER_EMAIL`
- `E2E_BUYER_EMAIL`
- `E2E_AGENT_ALPHA_API_KEY`
- `E2E_AGENT_BETA_API_KEY`
- `E2E_AGENT_ALPHA_MNEMONIC`
- `SOUL_UPLOAD_SECRET`（Phase 7.7 Seal 内容比对用）

**运行时变量（Phase -1 动态发现 + 测试流程中捕获）：**
- `SELLER_ADDR` / `BUYER_ADDR` / `AGENT_ALPHA_ADDR` / `AGENT_BETA_ADDR` — Phase -1.2 DB 查询 + Sui CLI 验证
- `SELLER_MEMBER_ID` — Phase -1.2 记录（Phase 10.6 Follow 用）
- `SOUL_A_ID` / `SOUL_A_STATE_OBJ` / `SOUL_B_ID` / `COLLECTION_ID` — 测试流程中捕获
- `CAPTURED_RAW_ENVELOPE` — Phase 7.7 可选白盒比对（当前默认无）

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
DELETE FROM "soul_collections";
DELETE FROM "soul_assets";
DELETE FROM "follows";
DELETE FROM "bookmarks";
```
不清 members / wallet_bindings / agents。

### -1.2 动态发现测试账号地址（Sui CLI 全自动）

**Step 1 — DB 查询发现钱包地址：**
```sql
-- 人类账号（Seller + Buyer）
SELECT m.id, m.kind, m.email, wb.address
FROM members m
JOIN wallet_bindings wb ON wb.member_id = m.id
WHERE m.email IN ($E2E_SELLER_EMAIL, $E2E_BUYER_EMAIL)
  AND wb.chain = 'sui';

-- Agent 账号
SELECT m.id, m.kind, m.agent_status, wb.address
FROM members m
JOIN wallet_bindings wb ON wb.member_id = m.id
WHERE m.kind = 'agent' AND m.agent_status = 'active'
  AND m.api_key_hash IS NOT NULL AND wb.chain = 'sui';
```
记录 4 个运行时变量：**SELLER_ADDR**、**BUYER_ADDR**、**AGENT_ALPHA_ADDR**、**AGENT_BETA_ADDR**
记录 Seller 的 `member.id` 作为 **SELLER_MEMBER_ID**（Phase 10.6 Follow 测试用）。

> 若 DB 中无 agent 记录，需先运行 `npx tsx scripts/e2e-setup-agents.ts` 创建。

**Step 2 — Sui CLI 链上验证地址存在：**
```bash
sui client balance $SELLER_ADDR
sui client balance $BUYER_ADDR
sui client balance $AGENT_ALPHA_ADDR
sui client balance $AGENT_BETA_ADDR
```
4 个地址均应返回余额信息（即使为 0 也说明地址在链上存在）。

### -1.3 验证 + 自动补给钱包余额（Sui CLI 全自动）

**最低余额要求：**

| 角色 | SUI Gas | Test USDC | 用途 |
|------|---------|-----------|------|
| Seller | ≥0.1 SUI | — | Create/List/Grant TX gas |
| Buyer | ≥0.1 SUI | ≥5 USDC | 购买 Soul A ($1) + gas |
| Agent Alpha | ≥0.1 SUI | ≥5 USDC | Agent 购买 Soul B ($2) + gas |
| Agent Beta | ≥0.1 SUI | — | 仅 403 验证，无购买 |

**USDC 余额不足时 — 自动 mint（全自动，无需人工）：**

> 前提：`sui client active-address` 必须为 Treasury Cap owner。
> 若不是：`sui client switch --address 0x76fd52cac79bda80806be6b5ab7f3b1f099a966203cce809254919a7ab755728`

```bash
# 为 Buyer mint 10 USDC（10,000,000 atomic units）
sui client call \
  --package 0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325 \
  --module usdc --function mint \
  --args 0x56033240326fa75ab7986654d87aa3f2c8168212492edc7d7ee4755f30189184 \
         10000000 $BUYER_ADDR \
  --gas-budget 10000000

# 为 Agent Alpha mint 10 USDC
sui client call \
  --package 0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325 \
  --module usdc --function mint \
  --args 0x56033240326fa75ab7986654d87aa3f2c8168212492edc7d7ee4755f30189184 \
         10000000 $AGENT_ALPHA_ADDR \
  --gas-budget 10000000
```

**SUI Gas 不足时 — testnet faucet（全自动）：**
```bash
sui client faucet --address $SELLER_ADDR
sui client faucet --address $BUYER_ADDR
sui client faucet --address $AGENT_ALPHA_ADDR
sui client faucet --address $AGENT_BETA_ADDR
```

**Mint 后验证：**
```bash
sui client balance --coin-type "0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325::usdc::USDC" $BUYER_ADDR
sui client balance --coin-type "0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325::usdc::USDC" $AGENT_ALPHA_ADDR
```

### -1.4 验证测试 Fixture

验证文件存在且完整：
```bash
ls -la /Users/admin/Documents/example/soul.md \
       /Users/admin/Documents/example/memory.md \
       /Users/admin/Documents/example/images.jpeg \
       /Users/admin/Documents/example/skill.zip \
       /Users/admin/Documents/example-collection/soul-collection-template.xlsx \
       /Users/admin/Documents/example-collection/1/soul.md \
       /Users/admin/Documents/example-collection/1/memory.md \
       /Users/admin/Documents/example-collection/1/images.jpeg \
       /Users/admin/Documents/example-collection/1/skill.zip
```

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
3. `evaluate_script` 验证搜索框 `input[placeholder="Search souls..."]` 存在
4. `evaluate_script` 验证页面含 "No live Soul listings"
5. `evaluate_script` 验证 navbar 有 "Login" 按钮

### Test 0.3: 截图存档
`take_screenshot` → `e2e/phase0-market-empty.png`

---

## Phase 1: Seller 登录 + 创建 Soul A & B（12 tests）

### Test 1.1: Seller 登录（手动 OTP #1）
1. `navigate_page` → `http://localhost:3100/market`
2. `click` navbar "Login" 按钮（selector: `button:has-text("Login")`，desktop 视口下在 navbar 右侧）
3. Privy 邮箱 modal 弹出 — 在 Privy iframe 中 `fill` 本地注入的 seller 邮箱 `$E2E_SELLER_EMAIL` 并提交
4. **暂停等用户输入 OTP** — `wait_for` AccountButton 出现（selector: navbar 中 `.rounded-full.border.border-border.bg-card2` 按钮），timeout 120s
5. `evaluate_script` 确认 "Login" 按钮不存在
6. `take_screenshot` → `e2e/phase1-seller-login.png`

### Test 1.2: 创建向导 Step 1 — Basic Info
1. `navigate_page` → `http://localhost:3100/create`
2. `wait_for` text "Step 1 — Basic Info"
3. `fill` Soul Name（`input[placeholder="e.g. AlphaScout, Kaze no Akira..."]`）: `E2E Soul Alpha NW`
4. `fill` Description（`textarea[placeholder*="Describe your Soul"]`）: `E2E test Soul A — alpha trading strategy content`
5. **Cover image 上传 — fixture file:**
   ```
   upload_file(selector: 'div[aria-label="Click to upload cover image"] input[type="file"]',
               filePath: '/Users/admin/Documents/example/images.jpeg')
   ```
6. `wait_for` text "images.jpeg"（确认文件已选择，provider 显示文件名）
7. `evaluate_script` 验证 Category 下拉默认 'Trading'（保持默认）
8. `fill` Tags 输入（`input[placeholder="e.g. ai, trading, signals"]`）: `e2e, test`
9. `evaluate_script` 验证 5% royalty 按钮默认推荐选中（4 个按钮：0% / 2.5% / 5% / 10%）

### Test 1.3: 创建向导 Step 2 — Living Content
1. `click` "Next: Living Content →" 按钮（`button:has-text("Next: Living Content")`）
2. `wait_for` text "Step 2 - Living Content"
3. **打标签** — UploadTarget 渲染 3 个 `<input type="file" className="sr-only">`，无 aria-label，需先标记：
   ```javascript
   evaluate_script(`
     const inputs = document.querySelectorAll('input[type="file"].sr-only');
     if (inputs[0]) inputs[0].setAttribute('data-e2e', 'char-input');
     if (inputs[1]) inputs[1].setAttribute('data-e2e', 'memory-input');
     if (inputs[2]) inputs[2].setAttribute('data-e2e', 'skills-input');
     return inputs.length;
   `)
   ```
   验证返回 `3`。
4. **Soul Character 上传:**
   ```
   upload_file(selector: 'input[data-e2e="char-input"]',
               filePath: '/Users/admin/Documents/example/soul.md')
   ```
5. `wait_for` text "soul.md"（确认文件名出现）
6. **Memory 上传:**
   ```
   upload_file(selector: 'input[data-e2e="memory-input"]',
               filePath: '/Users/admin/Documents/example/memory.md')
   ```
7. `wait_for` text "memory.md"（确认文件名出现）
8. **Skills 上传:**
   ```
   upload_file(selector: 'input[data-e2e="skills-input"]',
               filePath: '/Users/admin/Documents/example/skill.zip')
   ```
9. `wait_for` text "skill.zip"（确认文件名出现）

### Test 1.4: 创建向导 Step 3 — Preview（2×2 Review Grid）
1. `click` "Next: Soul Awakened →" 按钮（`button:has-text("Next: Soul Awakened")`）
2. `wait_for` text "Step 3"
3. `evaluate_script` 验证 Basic Info card 显示 "E2E Soul Alpha NW"
4. `evaluate_script` 验证 royalty 显示 "5%"
5. `evaluate_script` 验证 Soul Character card 显示 "soul.md"
6. `evaluate_script` 验证 Memory card 显示 "memory.md"

### Test 1.5: 创建向导 Step 4 — Gas & Deploy
1. `click` "Next: Pay Gas →" 链接（`a[href="/create/gas"]`）
2. `wait_for` text "Step 4" 或 "Transaction Preview"
3. Gas 页守卫: `missingStep1` → redirect `/create`，`missingStep2` → redirect `/create/content`。必须从 wizard 顺序走到，保持 CreateSoulProvider context。

> **注意**: Gas 页 `handleDeploy()` 内部完成全流程：upload cover(public) → char(encrypted) → memory(encrypted) → skills(encrypted) → buildPublishSoulTx → signAndExecute → POST `/api/souls/publish` mirror 同步。Privy embedded wallet 自动签名，无需手动介入。

### Test 1.6: Deploy Soul A — Sign & Deploy
1. `click` "✓ Sign & Deploy" 按钮（`button:has-text("Sign & Deploy")`）
2. `wait_for` `[data-testid="publish-status"]` 出现，跟踪状态变化: uploading → building → signing → syncing
3. Privy embedded wallet 自动签名
4. `wait_for` URL 变为 `/create/success`（status=done 时自动 redirect），timeout 90s
5. `wait_for` text "Soul Born"（success 页标题）
6. 从 success 页提取 **SOUL_A_ID**（Soul Object ID 行）:
   ```javascript
   evaluate_script(`document.body.innerText.match(/0x[a-f0-9]{64}/)?.[0] ?? ''`)
   ```
6. `take_screenshot` → `e2e/phase1-soul-a-published.png`

### Test 1.7: 创建 Soul B — 完整 wizard 流程
重复 Tests 1.2-1.6 全流程，参数差异:
1. `navigate_page` → `http://localhost:3100/create`
2. Name: `E2E Soul Beta NW`，Description: `E2E test Soul B — held, not listed`
3. Cover: `upload_file` ← `/Users/admin/Documents/example/images.jpeg`
4. Content: 同 Test 1.3 — soul.md, memory.md, skill.zip 均来自 `/Documents/example/`
5. Preview → Gas → Sign & Deploy
6. 从 success 页捕获 **SOUL_B_ID**

### Test 1.8: Soul A 详情页 — Held 状态
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_A_ID}`
2. `wait_for` text "E2E Soul Alpha NW"
3. `evaluate_script` 验证 hero badge 含 "Held"（mint 后默认 held）
4. `evaluate_script` 验证 owner CTA 为 "List Soul"（`a:has-text("List Soul")`）
5. `evaluate_script` 验证 Protocol State 卡片显示 Soul/State/Memory object ID，并从其中记录 **SOUL_A_STATE_OBJ**
6. `evaluate_script` 验证 Access 卡片显示 "Grant capacity: 0 /"
7. `evaluate_script` 验证 MemoryPanel 组件渲染（页面含 "Memory" kicker 文本）
8. `evaluate_script` 验证 SkillsPanel 组件渲染（页面含 "Skills" kicker 文本）

### Test 1.9: Soul B 详情页 — Held 状态
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_B_ID}`
2. `wait_for` text "E2E Soul Beta NW"
3. `evaluate_script` 验证 hero badge 含 "Held"
4. `evaluate_script` 验证 CTA 为 "List Soul"

### Test 1.10: Market 空状态（两个 Soul 均 held，未上架）
1. `navigate_page` → `http://localhost:3100/market`
2. `evaluate_script` 验证 "No live Soul listings" 仍然出现（market 只显示 listed 状态）

### Test 1.11: My Souls — Seller Portfolio（5 tabs）
1. `navigate_page` → `http://localhost:3100/my-souls`
2. `wait_for` text "My Souls"
3. `evaluate_script` 验证 5 个 tab 存在：Owned / Collections / Listings / Activity / Bookmarks
4. `evaluate_script` 验证 Owned tab 默认选中，显示 2 个 soul row
5. `click` "Collections" tab → 验证 "No collection rights yet"
6. `click` "Bookmarks" tab → 验证 "No bookmarks yet"

### Test 1.12: 截图存档
`take_screenshot` → `e2e/phase1-seller-done.png`

---

## Phase 2: 上架 Soul A & B（6 tests）

### Test 2.1: List Soul A — Set Price $1
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_A_ID}/sell`
2. `wait_for` text "List Soul"
3. `evaluate_script` 验证 Soul 名称 "E2E Soul Alpha NW" 显示
4. `fill` price input（`input[type="number"][placeholder="0.00"]`）: `1`
5. `evaluate_script` 验证 "Next: Authorize →" 链接已激活

### Test 2.2: List Soul A — Authorize & Sign
1. `click` "Next: Authorize →"（`a:has-text("Next: Authorize")`）
2. `wait_for` URL 含 `/sell/authorize`
3. `wait_for` text "Authorize listing"
4. `evaluate_script` 验证 Wallet Request 卡片显示: Soul name, Ask price "1.00 USDC", Creator royalty
5. `click` "✓ Sign & List" 按钮（`button:has-text("Sign & List")`）
6. Privy embedded wallet 自动签名 `list_fixed_price` TX
7. `wait_for` URL 变为 `/sell/success`，timeout 60s

### Test 2.3: List Soul A — Success
1. `wait_for` text "Soul listed"
2. `evaluate_script` 验证: Soul name + "1.00 USDC" + "Live in kiosk market"
3. `take_screenshot` → `e2e/phase2-soul-a-listed.png`

### Test 2.4: List Soul B — Set Price $2
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_B_ID}/sell`
2. `wait_for` text "List Soul"
3. `fill` price input: `2`

### Test 2.5: List Soul B — Authorize & Sign
1. `click` "Next: Authorize →"
2. `wait_for` URL 含 `/sell/authorize`
3. `click` "✓ Sign & List"
4. `wait_for` URL 变为 `/sell/success`，timeout 60s

### Test 2.6: Market 显示 2 个 Listed Soul
1. `navigate_page` → `http://localhost:3100/market`
2. `evaluate_script` 验证 "E2E Soul Alpha NW" 和 "E2E Soul Beta NW" 两个 card 均可见
3. `evaluate_script` 验证 "No live Soul listings" 不再出现
4. `take_screenshot` → `e2e/phase2-market-listed.png`

### Test 2.7: Market 排序
1. 在 market 页，修改 Sort 下拉为 "Price: Low to High":
   ```javascript
   evaluate_script(`
     const select = document.querySelector('select');
     if (select) { select.value = 'price_asc'; select.dispatchEvent(new Event('change', { bubbles: true })); }
     return select?.value ?? '';
   `)
   ```
2. `wait_for` 列表刷新
3. `evaluate_script` 验证第一个 Soul card 是 Soul A（$1），第二个是 Soul B（$2）
4. 切回 "Newest" 恢复默认

### Test 2.8: Market 高级筛选 — Price Range
1. `click` "Filters" 按钮（`button:has-text("Filters")`）
2. `wait_for` 筛选面板出现（"Price Range" 文本可见）
3. `fill` Min Price（`input[placeholder="Min"]`）: `0.5`
4. `fill` Max Price（`input[placeholder="Max"]`）: `1.5`
5. `wait_for` 列表更新（debounce 300ms）
6. `evaluate_script` 验证只有 Soul A（$1）可见，Soul B（$2）被过滤
7. `click` "Clear filters"（`button:has-text("Clear filters")`）
8. `evaluate_script` 验证两个 Soul 均恢复可见
9. `take_screenshot` → `e2e/phase2-market-filters.png`

---

## Phase 3: Collection 创建 + Floor Guard（6 tests）

> Seller 仍登录，在同一 session 内完成 Collection 创建。

### Test 3.1: Collection Step 1 — Collection Info
1. `navigate_page` → `http://localhost:3100/collections/create`
2. `wait_for` text "Step 1"
3. `fill` Collection Name（`input` placeholder 含 "Cyber Sentinels"）: `E2E Collection Alpha`
4. `fill` Description（`textarea` placeholder 含 "What is this Collection about"）: `E2E test collection with one Soul`
5. **Cover image 上传:**
   ```
   upload_file(selector: 'div[aria-label="Upload cover image"] input[type="file"]',
               filePath: '/Users/admin/Documents/example/images.jpeg')
   ```
6. `wait_for` text "images.jpeg"
7. `fill` Floor Price（`input[type="number"]` placeholder 含 "e.g. 10"）: `5`
8. `evaluate_script` 验证 5% royalty 按钮默认选中（4 个按钮：0% / 2.5% / 5% / 10%）
9. `evaluate_script` 验证 "Soul Collection + Resale" toggle 默认 tradeable

### Test 3.2: Collection Step 2 — Batch Upload（directory 模拟）
1. `click` Next 按钮进入 Step 2
2. `wait_for` text "Step 2"
3. `click` "Batch Upload" 方法卡片

**Directory upload 模拟** — `upload_file` 无法模拟 `webkitdirectory` picker。使用 `evaluate_script` 构造 File 对象：

先用 bash 将 fixture 文件转 base64：
```bash
XLSX_B64=$(base64 -i /Users/admin/Documents/example-collection/soul-collection-template.xlsx)
SOUL_B64=$(base64 -i /Users/admin/Documents/example-collection/1/soul.md)
MEM_B64=$(base64 -i /Users/admin/Documents/example-collection/1/memory.md)
IMG_B64=$(base64 -i /Users/admin/Documents/example-collection/1/images.jpeg)
SKILL_B64=$(base64 -i /Users/admin/Documents/example-collection/1/skill.zip)
```

然后注入浏览器：
```javascript
evaluate_script(`
  (async () => {
    function b64toFile(b64, name, type, relPath) {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const f = new File([arr], name, { type });
      Object.defineProperty(f, 'webkitRelativePath', { value: relPath });
      return f;
    }
    const dt = new DataTransfer();
    dt.items.add(b64toFile('${XLSX_B64}', 'soul-collection-template.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'example-collection/soul-collection-template.xlsx'));
    dt.items.add(b64toFile('${SOUL_B64}', 'soul.md', 'text/markdown',
      'example-collection/1/soul.md'));
    dt.items.add(b64toFile('${MEM_B64}', 'memory.md', 'text/markdown',
      'example-collection/1/memory.md'));
    dt.items.add(b64toFile('${IMG_B64}', 'images.jpeg', 'image/jpeg',
      'example-collection/1/images.jpeg'));
    dt.items.add(b64toFile('${SKILL_B64}', 'skill.zip', 'application/zip',
      'example-collection/1/skill.zip'));

    const input = document.querySelector('input[type="file"][webkitdirectory]');
    Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return dt.files.length;
  })()
`)
```

4. `wait_for` 确认 modal 出现
5. `click` Confirm 按钮
6. `wait_for` text "1 Soul ready — all files matched"

### Test 3.3: Collection Step 3 — Preview & Launch
1. `click` Next 按钮进入 Preview（`button:has-text("Next")`）
2. `wait_for` text "Step 3" 或 "Preview"
3. `evaluate_script` 验证 collection name "E2E Collection Alpha", floor "5 USDC", royalty "5%"
4. `evaluate_script` 验证 1 个 Soul row 含 "Ready" tag
5. `click` "Sign & Launch →" 按钮（`button:has-text("Sign & Launch")`）
6. Privy 自动签名（多笔 TX: create collection → upload files → mint soul → bind soul）
7. `wait_for` URL 含 `/collections/create/success`，timeout 120s（多笔 TX）

### Test 3.4: Collection Success
1. `wait_for` text "Collection Born"
2. `evaluate_script` 提取 **COLLECTION_ID**
3. `take_screenshot` → `e2e/phase3-collection-created.png`

### Test 3.5: Collection 详情页
1. `navigate_page` → `http://localhost:3100/collections/${COLLECTION_ID}`
2. `evaluate_script` 验证 collection 显示 1 个 Soul, floor price, royalty

### Test 3.6: Collection 子 Soul 低于 Floor Price 时禁止继续上架
1. 在 collection 详情页刷新 snapshot，定位第一个子 Soul card（链接目标为 `/souls/{id}`）并点击进入
2. 记录该子 Soul 的 `onChainId`，然后 `navigate_page` → `http://localhost:3100/souls/${CHILD_SOUL_ID}/sell`
3. `wait_for` text "Step 1 — Set Your Price"
4. `fill` price input（定位提示：`input[type="number"][placeholder="0.00"]`）: `4.99`
5. `evaluate_script` 验证页面出现 floor 提示："Minimum price for this collection is 5"
6. `evaluate_script` 验证继续按钮不是 `"Next: Authorize →"` 链接，而是 disabled 按钮 `"Enter a valid price"`

---

## Phase 4: Buyer 登录 + 购买（6 tests）

### Test 4.1: Seller 登出
1. `click` navbar AccountButton（`.rounded-full.border.border-border.bg-card2` 按钮）
2. `wait_for` dropdown 出现（含 "Sign Out" 文字）
3. `click` "Sign Out"（`button:has-text("Sign Out")`，红色 `text-danger`）
4. `wait_for` "Login" 按钮重新出现

### Test 4.2: Buyer 登录（手动 OTP #2）
1. `click` "Login"
2. Privy modal 填本地注入的 buyer 邮箱 `$E2E_BUYER_EMAIL`
3. **暂停等用户输入 OTP** — timeout 120s
4. `wait_for` AccountButton 出现
5. `take_screenshot` → `e2e/phase4-buyer-login.png`

### Test 4.3: Market 显示 2 个 Listed Soul
1. `navigate_page` → `http://localhost:3100/market`
2. `evaluate_script` 验证 "E2E Soul Alpha NW" 和 "E2E Soul Beta NW" 两个 card 均可见

### Test 4.3a: Bookmark Soul B — 从 Market 页
1. 找到 Soul B card 上的 bookmark 按钮（`button[aria-label="Bookmark this Soul"]`）
2. `click` bookmark 按钮
3. `wait_for` 按钮变为 filled 状态（`aria-label` 变为 `"Remove bookmark"`）
4. `take_screenshot` → `e2e/phase4-bookmark-on.png`

### Test 4.3b: My Souls Bookmarks Tab 验证
1. `navigate_page` → `http://localhost:3100/my-souls`
2. `click` "Bookmarks" tab（`button:has-text("Bookmarks")`）
3. `evaluate_script` 验证 bookmark 列表包含 "E2E Soul Beta NW"

### Test 4.3c: Remove Bookmark
1. `navigate_page` → `http://localhost:3100/market`
2. 找到 Soul B card 上的 bookmark 按钮（`button[aria-label="Remove bookmark"]`）
3. `click` 取消 bookmark
4. `wait_for` 按钮变回 unfilled（`aria-label="Bookmark this Soul"`）
5. `navigate_page` → `http://localhost:3100/my-souls`
6. `click` "Bookmarks" tab → 验证 "No bookmarks yet" 空状态

### Test 4.4: Buy Page — 审核 Soul A 报价
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_A_ID}/buy`
2. `wait_for` text "Confirm purchase"
3. `evaluate_script` 验证报价明细:
   - "List price" 行
   - "Protocol fee" 行
   - "Creator royalty" 行
   - "Collection royalty" 行
   - "Total" 行（gold 文字）
4. `evaluate_script` 验证 "Buy for ..." 金色按钮可点击

### Test 4.5: 执行购买 Soul A
1. `click` "Buy for ..." 按钮（`button:has-text("Buy for")`）
2. `wait_for` 按钮文字变为 "⟳ Building TX…" / "⟳ Signing…" / "⟳ Syncing…"
3. Privy embedded wallet 自动签名 `purchase()` TX
4. `wait_for` text "Soul acquired"（success 状态），timeout 60s
5. `evaluate_script` 验证 success 卡片: Soul name + 支付金额 + TX digest
6. `evaluate_script` 验证 "View in My Souls" 链接（`a[href="/my-souls"]`）
7. `take_screenshot` → `e2e/phase4-soul-a-purchased.png`

### Test 4.6: Buyer My Souls — Owned 1
1. `navigate_page` → `http://localhost:3100/my-souls`
2. `evaluate_script` 验证 Owned tab 显示 1 个 soul row（Soul A）
3. `click` "Collections" tab → 验证 "No collection rights yet"
4. `click` "Activity" tab → 验证 "No activity yet"

---

## Phase 5: Grant 系统（7 tests）

### Test 5.1: Buyer 查看 Soul A 详情（Owner 视角）
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_A_ID}`
2. `wait_for` text "E2E Soul Alpha NW"
3. `evaluate_script` 验证 hero badge 含 "Held"（购买后从 listed 变 held）
4. `evaluate_script` 验证 Active Grants: "No active SoulGrant is attached to this Soul."
5. `evaluate_script` 验证 owner CTA 为 "List Soul"（owner + held）

### Test 5.2: Issue SoulGrant to Agent Alpha — via GrantModal UI

1. `navigate_page` → `http://localhost:3100/my-souls`
2. `wait_for` "My Souls"
3. 在 Soul A 的 SoulCard 上点击 `"🔑 Grant Access"` 按钮（`button:has-text("Grant Access")`）
4. GrantModal 弹出 — `wait_for` text "SoulGrant Management"
5. `evaluate_script` 验证 scope 显示："Skills & Docs · read + update" 和 "Memory · read + append"
6. `evaluate_script` 验证 Current Grant 显示 "No agent authorized"
7. `fill` agent address input（`input[placeholder="0x_agent_address_or_ocl_id"]`）: `$AGENT_ALPHA_ADDR`（Phase -1.2 动态发现的完整地址）
8. `click` "Authorize Agent →"（`button:has-text("Authorize Agent")`）
9. Privy 自动签名 `issue_grant` TX
10. `wait_for` modal 关闭（Toast "Agent authorized successfully" 出现）
11. 刷新 Soul A 详情页验证:
    - Active Grants 区域显示 1 条 grant
    - Grant row 含 Agent Alpha 地址前缀（`$AGENT_ALPHA_ADDR` 前 6 字符）
    - Grant scopes 含 scope tags
12. `take_screenshot` → `e2e/phase5-grant-issued.png`

### Test 5.3: Agent Alpha → Soul A: 200（granted-agent via new-web）
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```
验证:
- HTTP 200
- `accessKind` = `"granted-agent"`
- `accessPolicy.functionName` = `"seal_approve_granted_agent"`
- `accessPolicy.soulGrantObjectId` 非空（指向链上 SoulGrant 对象）

### Test 5.4: Agent Beta → Soul A: 403（无 Grant）
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_BETA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```
验证 HTTP 403

### Test 5.5: My Souls — Activity tab
1. `navigate_page` → `http://localhost:3100/my-souls`
2. `click` "Activity" tab
3. `evaluate_script` 验证至少 1 条 grant record
4. `evaluate_script` 验证 grant row 含 "active" status tag + "seal"/"memory" scope tags

### Test 5.6: Revoke SoulGrant — via GrantModal UI
1. `navigate_page` → `http://localhost:3100/my-souls`
2. 在 Soul A 的 SoulCard 上点击 `"🔐 Manage Grant"` 按钮（`button:has-text("Manage Grant")`）
3. GrantModal 弹出
4. `wait_for` "Agent Authorized" 文本（active grant 状态指示器，绿色圆点）
5. `evaluate_script` 验证 grantee 地址前缀（`$AGENT_ALPHA_ADDR` 前 6 字符）显示
6. `click` "Revoke" 按钮（`button:has-text("Revoke")`，danger variant）
7. Privy 自动签名
8. `wait_for` modal 关闭（Toast "Grant revoked"）
9. 刷新 Soul A 详情页 → 验证 "No active SoulGrant is attached to this Soul."
10. `take_screenshot`

### Test 5.7: Agent Alpha revoked → 403（Grant 已撤销）
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```
验证 HTTP 403

---

## Phase 6: Skills & Memory（4 tests）

### Test 6.1: Skills Panel 初始状态
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_A_ID}`
2. 定位 Skills 面板（`SkillsPanel` 组件）
3. `evaluate_script` 验证显示 owner 级别操作（Buyer 是 owner）

### Test 6.2: Append Skills Version
1. 在 Skills 面板中找到上传 input，上传 fixture skill bundle:
   ```
   upload_file(selector: '<SkillsPanel 内的 input[type="file"]>',
               filePath: '/Users/admin/Documents/example/skill.zip')
   ```
   > Selector 需运行时通过 `evaluate_script` 定位 SkillsPanel 内的隐藏 file input 并打标签。
2. `click` "Append Version" 按钮
3. Privy 自动签名 `append_version_as_owner()` TX
4. `wait_for` 新 skill version row 出现
5. `evaluate_script` 验证 version row 含 "private" tag + blob 地址

### Test 6.3: Memory Panel 渲染 Smoke
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_A_ID}`
2. `evaluate_script` 验证 MemoryPanel 渲染："Memory" kicker 文本可见
3. `evaluate_script` 验证 founding memory entry 存在（writerKind 为 "Founder"，purple tag）
4. `evaluate_script` 验证 entry row 含 lock icon（加密 blob 指示器）
5. 不做 memory append 操作 — 仅渲染 smoke test

### Test 6.4: Owner Decrypt Skills Version
1. 在 skill version row 点击 "Decrypt" 按钮
2. Privy 签名 Seal personal message
3. `wait_for` 按钮从 loading 恢复
4. `list_console_messages` 验证无 error

---

## Phase 7: Agent API 功能验证（7 tests，其中 5 项主流程 + 1 项外部依赖 + 1 项白盒附加）

> 全部走 new-web Agent API（port 3100），不依赖 legacy web。

### Test 7.1: Agent Soul Search
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  "http://localhost:3100/api/agent/souls/search?q=E2E&limit=10"
```
验证:
- HTTP 200
- `items` 数组含 Soul B（listed 状态）
- 每个 item 含 `onChainId`, `name`, `listedPriceAtomic`, `listingStatus`

### Test 7.2: Agent Soul Detail
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_B_ID}
```
验证 HTTP 200 + response 含 Soul B 完整信息（name, description, listingStatus=listed, listedPriceAtomic）

### Test 7.3: Agent Alpha 购买 Soul B（两步签名）
**Step 1 — 准备 TX：**
```bash
curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  http://localhost:3100/api/agent/souls/${SOUL_B_ID}/purchase
```
验证 HTTP 200 + 捕获 `preparedPurchaseId` 和 `txBytes`（base64）

**Step 2 — 签名执行：**
使用 Agent Alpha 的 Ed25519 keypair（从 `AGENT_MNEMONIC` 派生）对 `txBytes` 签名:
```bash
cd /Users/admin/Desktop/nao/clawnews && \
SOUL_ID=${SOUL_B_ID} \
AGENT_API_KEY="${E2E_AGENT_ALPHA_API_KEY}" \
AGENT_MNEMONIC="${E2E_AGENT_ALPHA_MNEMONIC}" \
BASE_URL=http://localhost:3100 \
npx tsx new-web/scripts/e2e-agent-purchase.ts
```
验证退出码 0 + 输出含 TX digest + `listingStatus: "held"`

### Test 7.4: Agent Alpha → Soul B: 200（owner）
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_B_ID}/access
```
验证:
- HTTP 200
- `accessKind` = `"owner"`
- `accessPolicy.functionName` = `"seal_approve_owner"`

### Test 7.5: 交叉验证矩阵（全走 new-web）
4 个 curl 均走 `localhost:3100`:

| Agent | Soul A | Soul B |
|-------|--------|--------|
| Alpha | 403 (grant revoked in Phase 5) | 200 (owner) |
| Beta  | 403 (无 grant) | 403 (非 owner) |

```bash
# Alpha → Soul A
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
# → 403

# Alpha → Soul B
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_B_ID}/access
# → 200

# Beta → Soul A
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_BETA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
# → 403

# Beta → Soul B
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_BETA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_B_ID}/access
# → 403
```

### Test 7.6: Agent Seal Decrypt Soul B（外部依赖验证，不计主流程通过口径）
```bash
SOUL_ID=${SOUL_B_ID} \
AGENT_API_KEY="${E2E_AGENT_ALPHA_API_KEY}" \
AGENT_MNEMONIC="${E2E_AGENT_ALPHA_MNEMONIC}" \
BASE_URL=http://localhost:3100 \
npx tsx new-web/scripts/e2e-agent-decrypt.ts
```
验证:
- 解密成功（退出码 0）
- Seal 调用 `seal_approve_owner`（Agent Alpha 是 owner）
- 输出 content hash 匹配

> 说明：此项依赖 Seal key server 可达、`@mysten/seal` 运行环境和测试网络稳定；失败时应单独记为外部依赖阻塞，不拉低主流程通过率。

### Test 7.7: Seal 加密内容与原始文件逐字节比对（白盒附加验证，不计 E2E 主流程通过口径）

前置：Agent Alpha 已购买 Soul B（Test 7.3）并拥有 owner 访问权（Test 7.4）。此项不是黑盒 E2E，而是排查内容打包/加密问题时的白盒比对。

当前仓库状态：

- `CAPTURED_RAW_ENVELOPE` 仍依赖 gas 页额外暴露 `window.__e2eLastRawEnvelope`
- 该暴露点当前**未落地**
- 因此本项默认标记为 `optional / pending-impl`，不进入本轮主流程通过口径

```bash
SOUL_ID=${SOUL_B_ID} \
AGENT_API_KEY="${E2E_AGENT_ALPHA_API_KEY}" \
RAW_ENVELOPE="${CAPTURED_RAW_ENVELOPE}" \
COMPARE_DIR="/Users/admin/Documents/example" \
npx tsx new-web/scripts/e2e-agent-verify-content.ts
```
验证:
- 退出码 0
- 每个文件（soul.md, memory.md, images.jpeg, skill.zip）显示 `✅ MATCH`
- 最终输出 "All files match!"

**实现依赖：** gas 页需新增 `window.__e2eLastRawEnvelope` 暴露点（当前未实现）。

---

## Phase 8: Import 流程（5 tests）

> Buyer 仍登录，使用 `/Documents/example/` fixture 文件测试 Import 功能。

### Test 8.1: Import Step 1 — 选择来源
1. `navigate_page` → `http://localhost:3100/import`
2. `wait_for` text "Step 1"
3. `evaluate_script` 验证 source 选项存在
4. `click` "Local File" 或合适的来源选项
5. `click` Next 按钮

### Test 8.2: Import Step 2-3 — 上传 + 字段映射
1. `wait_for` upload 或 map 页面
2. 手动填写 Soul Name: `E2E Imported Soul`, Description: `Imported from local file`
3. **上传 fixture 文件** — Import map 页有 4 个 UploadTarget（与 create/content 结构类似）:
   ```javascript
   evaluate_script(`
     const inputs = document.querySelectorAll('input[type="file"].sr-only');
     inputs.forEach((inp, i) => inp.setAttribute('data-e2e', 'import-input-' + i));
     return inputs.length;
   `)
   ```
   按顺序上传:
   - Soul Character: `upload_file` ← `/Users/admin/Documents/example/soul.md`
   - Memory: `upload_file` ← `/Users/admin/Documents/example/memory.md`
   - Skills: `upload_file` ← `/Users/admin/Documents/example/skill.zip`
   - Cover Image — 使用 UploadZone:
     ```
     upload_file(selector: 'div[aria-label*="upload cover"] input[type="file"]',
                 filePath: '/Users/admin/Documents/example/images.jpeg')
     ```
4. `wait_for` 所有文件上传确认
5. `click` Next 按钮

### Test 8.3: Import Preview
1. `wait_for` preview 页面
2. `evaluate_script` 验证 import provenance badge 显示 "imported"
3. `evaluate_script` 验证 Soul name "E2E Imported Soul" 显示

### Test 8.4: Import Gas & Deploy
1. `click` proceed 按钮进入 gas 页
2. `click` "Sign & Deploy" 按钮（`button:has-text("Sign & Deploy")`）
3. Privy 自动签名
4. `wait_for` URL 含 `/import/success`，timeout 90s

### Test 8.5: Import Success
1. `wait_for` success 页面内容
2. `evaluate_script` 提取 imported Soul on-chain ID
3. `take_screenshot` → `e2e/phase8-import-done.png`

---

## Phase 9: API 边界 & Hardening（6 tests）

> 全部走 new-web（port 3100）。

### Test 9.1: Invalid API key → 401
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer sk-invalid-000000" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```

### Test 9.2: No auth header → 401
```bash
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```

### Test 9.3: Non-sk token → 401
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer eyJhbGciOiJFZERTQSJ9.fake.jwt" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```
验证 Agent API 只接受 `sk-` 前缀 token

### Test 9.4: Soul not found → 404
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  http://localhost:3100/api/agent/souls/0x0000000000000000000000000000000000000000000000000000000000000000/access
```

### Test 9.5: No permission → 403
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_BETA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```

### Test 9.6: Public Soul 详情 API → 404（不存在的 Soul）
```bash
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3100/api/souls/0x0000000000000000000000000000000000000000000000000000000000000000
```

---

## Phase 10: 页面渲染冒烟（6 tests）

### Test 10.1: Community Page
1. `navigate_page` → `http://localhost:3100/community`
2. `wait_for` text "Soul Feed"
3. `evaluate_script` 验证 filter tabs 至少包含 "New" 和 "Top"
4. `evaluate_script` 验证侧栏标题为 "Top Contributors"
5. `evaluate_script` 验证主列要么渲染 `article` 列表，要么显示 "No posts yet. Be the first to publish!"

### Test 10.2: Resources — Content Format + Getting Started
1. `navigate_page` → `http://localhost:3100/resources/content-format`
2. `wait_for` text "soul.md" 或 "Content Format"
3. `evaluate_script` 验证页面含 soul.md / memory.md / skill.zip 格式说明
4. `navigate_page` → `http://localhost:3100/resources/getting-started`
5. `wait_for` 页面加载完成（无 error overlay）

### Test 10.3: Wrap + Link Page
1. `navigate_page` → `http://localhost:3100/wrap-link`
2. `wait_for` text "Expand to Soul"
3. `evaluate_script` 验证页面存在 "Personal Join" 入口 card，且无 `Collection Expand` 断言

### Test 10.4: Community Leaderboard
1. `navigate_page` → `http://localhost:3100/community/leaderboard`
2. `wait_for` text "Most Active" 或 "Most Helpful"
3. `evaluate_script` 验证 leaderboard 列表或空状态渲染

### Test 10.5: Resources Stats
1. `navigate_page` → `http://localhost:3100/resources/stats`
2. `wait_for` 页面加载完成（无 error overlay）
3. `evaluate_script` 验证页面含统计数据或空状态

### Test 10.6: Follow/Unfollow — Community Profile
1. `navigate_page` → `http://localhost:3100/community/u/${SELLER_MEMBER_ID}`
2. `wait_for` profile 加载（用户名可见）
3. `click` "Follow" 按钮（`button:has-text("Follow")`）
4. `wait_for` 按钮文案变为 "Following"
5. `evaluate_script` 验证 "Followers" 文本旁计数 ≥ 1
6. `click` "Following" 按钮 → unfollow
7. `wait_for` 按钮文案变回 "Follow"
8. `take_screenshot` → `e2e/phase10-follow-toggle.png`

---

## Phase 11: Cleanup（1 test）

### Test 11.1: 清理
1. `evaluate_script`: `localStorage.clear(); sessionStorage.clear();`
2. 运行 DB 清理 SQL（同 Phase -1.1）:
   ```sql
   DELETE FROM "soul_grant_records";
   DELETE FROM "soul_skill_versions";
   DELETE FROM "soul_memory_entries";
   DELETE FROM "soul_prepared_purchases";
   DELETE FROM "soul_tx_syncs";
   DELETE FROM "soul_collection_assets";
   DELETE FROM "soul_collections";
   DELETE FROM "soul_assets";
   DELETE FROM "follows";
   DELETE FROM "bookmarks";
   ```
3. `navigate_page` → `http://localhost:3100/market`
4. `evaluate_script` 验证 "No live Soul listings" 恢复
5. `take_screenshot` → `e2e/phase11-cleanup.png`

---

## 手动介入点（仅 2 次 OTP，其余全自动）

> **全自动声明：** 本计划除以下 2 次 OTP 输入外，所有操作均由 AI agent 独立完成，无需人工判断或干预。

1. **Test 1.1** — Seller Privy OTP（`$E2E_SELLER_EMAIL`）→ 用户输入 6 位验证码
2. **Test 4.2** — Buyer Privy OTP（`$E2E_BUYER_EMAIL`）→ 用户输入 6 位验证码

**以下操作全部自动化，无需人工介入：**
- Privy embedded wallet TX 签名（所有 Phase 的链上交易）
- `sui client` 链上状态查询与 USDC mint（Phase -1）
- Chrome DevTools MCP 浏览器操作（Phase 0-8, 10-11）
- Agent API `curl` 调用（Phase 7, 9）
- DB SQL 验证（Phase -1, 11）
- `npx tsx` E2E 脚本（Phase 7.3, 7.6, 7.7）
- 截图存档（全 Phase）

---

## 状态依赖链

```
Phase -1 (cleanup) → Phase 0 (pre-flight)
Test 1.1 (seller login) → Tests 1.2-1.12
Tests 1.6-1.7 (create Soul A + B, both held) → SOUL_A_ID, SOUL_B_ID；若未来补 `__e2eLastRawEnvelope` 再额外记录 `CAPTURED_RAW_ENVELOPE`
Phase 2 (list Soul A + B) → 两个 Soul 变 listed
Tests 2.7-2.8 (market sort/filter) ← 两个 Soul 均 listed 时执行
Phase 3 (collection) → seller session 内创建 Collection → COLLECTION_ID
Test 3.6 (collection floor guard) ← 依赖 collection detail 已正确镜像出子 Soul
Test 4.1 (seller logout) → Test 4.2 (buyer login)
Test 4.3 (market verify) → Tests 4.3a-4.3c (bookmark add/verify/remove)
Test 4.5 (purchase Soul A) → buyer owns Soul A → Phase 5+
Test 5.2 (issue grant via GrantModal) → Tests 5.3-5.5
Test 5.6 (revoke grant via GrantModal) → Test 5.7
Phase 6 (skills/memory) ← buyer 仍登录 + owns Soul A
Test 7.1-7.2 (agent search + detail) → 独立只读
Test 7.3 (agent purchase Soul B) → Tests 7.4-7.7
Test 7.6 (agent seal decrypt) ← 需 Seal key server 与网络环境可用
Test 7.7 (Seal content verify) ← 需 CAPTURED_RAW_ENVELOPE 暴露点落地 + Agent Alpha owns Soul B；默认不计主流程
Phase 8 (import) ← buyer 仍登录，创建新 Soul
Phase 9 (API boundary) → 独立于浏览器状态
Phase 10 (page renders + follow) ← 需 SELLER_MEMBER_ID
Phase 11 (cleanup) → 收尾
```

---

## 测试数量汇总

| Phase | Tests | 描述 |
|-------|-------|------|
| 0 | 3 | Pre-flight 冒烟 |
| 1 | 12 | Seller 登录 + Soul 创建 + 验证 |
| 2 | 8 | 上架 Soul A ($1) + Soul B ($2) + Market 排序/筛选 |
| 3 | 6 | Collection 创建（seller session 内）+ floor price guard |
| 4 | 9 | Buyer 登录 + Bookmark 增删 + 购买 Soul A |
| 5 | 7 | Grant 发放 / 验证 / 撤销（via GrantModal UI） |
| 6 | 4 | Skills append + Memory panel smoke + 解密 |
| 7 | 7 | Agent API 主流程 + Seal 外部依赖验证 + 白盒内容比对 |
| 8 | 5 | Import 流程 |
| 9 | 6 | API 边界测试（401/403/404） |
| 10 | 6 | 页面渲染冒烟 + Follow/Unfollow |
| 11 | 1 | Cleanup |
| **Total** | **74** | |

---

## Chrome DevTools MCP 定位提示速查

> 以下内容仅是定位提示，帮助你在最新 snapshot 里找到目标元素；真正执行时必须先 `take_snapshot`，再对对应 `uid` 使用 `click` / `fill` / `upload_file`。

| 元素 | Selector | 页面 |
|------|----------|------|
| Login | `button:has-text("Login")` | Navbar |
| AccountButton | `.rounded-full.border.border-border.bg-card2` | Navbar |
| Sign Out | `button:has-text("Sign Out")` (text-danger) | AccountButton dropdown |
| Search 框 | `input[placeholder="Search souls..."]` | /market |
| Sort 下拉 | `select` (值: newest/price_asc/price_desc/popular) | /market |
| Filters 切换 | `button:has-text("Filters")` | /market |
| Min Price | `input[placeholder="Min"]` | /market (advanced filters) |
| Max Price | `input[placeholder="Max"]` | /market (advanced filters) |
| Clear filters | `button:has-text("Clear filters")` | /market (advanced filters) |
| Bookmark（添加） | `button[aria-label="Bookmark this Soul"]` | /market |
| Bookmark（移除） | `button[aria-label="Remove bookmark"]` | /market |
| Soul Name | `input[placeholder="e.g. AlphaScout, Kaze no Akira..."]` | /create |
| Description | `textarea[placeholder*="Describe your Soul"]` | /create |
| Category | Category select（默认 'Trading'） | /create |
| Tags | `input[placeholder="e.g. ai, trading, signals"]` | /create |
| Price | `input[placeholder="0.00"][type="number"]` | /sell |
| Cover image (create) | `div[aria-label="Click to upload cover image"] input[type="file"]` | /create |
| Cover image (collection) | `div[aria-label="Upload cover image"] input[type="file"]` | /collections/create |
| Char input (打标后) | `input[data-e2e="char-input"]` | /create/content |
| Memory input (打标后) | `input[data-e2e="memory-input"]` | /create/content |
| Skills input (打标后) | `input[data-e2e="skills-input"]` | /create/content |
| Directory upload | `input[type="file"][webkitdirectory]` | /collections/create/souls |
| Royalty 5% | 5% 按钮（4 按钮组：0% / 2.5% / 5% / 10%） | /create |
| Next: Living Content | `button:has-text("Next: Living Content")` | /create |
| Next: Soul Awakened | `button:has-text("Next: Soul Awakened")` | /create/content |
| Next: Pay Gas | `a[href="/create/gas"]` | /create/preview |
| Sign & Deploy | `button:has-text("Sign & Deploy")` | /create/gas |
| Publish status | `[data-testid="publish-status"]` | /create/gas |
| Sign & List | `button:has-text("Sign & List")` | /souls/{id}/sell/authorize |
| Next: Authorize | `a:has-text("Next: Authorize")` | /souls/{id}/sell |
| Batch Upload | `button:has-text("Batch Upload")` | /collections/create/souls |
| Sign & Launch | `button:has-text("Sign & Launch")` | /collections/create/preview |
| Buy button | `button:has-text("Buy for")` | /souls/{id}/buy |
| Grant Access | `button:has-text("Grant Access")` | /my-souls (SoulCard) |
| Manage Grant | `button:has-text("Manage Grant")` | /my-souls (SoulCard) |
| Agent Address Input | `input[placeholder="0x_agent_address_or_ocl_id"]` | GrantModal |
| Authorize Agent | `button:has-text("Authorize Agent")` | GrantModal |
| Revoke | `button:has-text("Revoke")` (danger) | GrantModal |
| Follow | `button:has-text("Follow")` | /community/u/{id} |
| Following | `button:has-text("Following")` | /community/u/{id} |
| Owned tab | `button:has-text("Owned")` | /my-souls |
| Collections tab | `button:has-text("Collections")` | /my-souls |
| Listings tab | `button:has-text("Listings")` | /my-souls |
| Activity tab | `button:has-text("Activity")` | /my-souls |
| Bookmarks tab | `button:has-text("Bookmarks")` | /my-souls |
| List Soul | `a:has-text("List Soul")` | /souls/{id} (owner+held) |

---

## E2E Helper 函数（/create/gas 页面）

Gas 页（`new-web/app/create/gas/page.tsx`）在 `useEffect` 中挂载以下全局函数，仅在 CreateSoulProvider context 完整时可用：

| 函数 | 签名 | 用途 | E2E 使用 |
|------|------|------|----------|
| `__e2ePublish` | `(params: PublishParams) => Promise` | 触发 mint TX | Phase 1 create 流程 |
| `__e2eUpload` | `(fileContent: string, fileName: string, type?: 'public'\|'encrypted') => Promise<UploadResult>` | Walrus 文件上传 | Phase 1 create 流程 |
| `__e2eListSoul` | `(params: { currentKioskId, currentKioskCapOnChainId, stateObjectId, soulObjectId, priceAtomic }) => Promise` | 上架 | Phase 2 list 流程 |
| `__e2eGetAuthHeaders` | `() => Promise<Record<string, string>>` | 获取 auth headers | 通用 |
| `__e2eIssueGrant` | `(params: { stateObjectId, granteeAddress, scopeMask, soulObjectId }) => Promise` | 发放 grant | **已废弃** — Phase 5 改用 GrantModal UI |
| `__e2eRevokeGrant` | `(params: { stateObjectId, granteeAddress, soulObjectId }) => Promise` | 撤销 grant | **已废弃** — Phase 5 改用 GrantModal UI |
| `__e2eLastRawEnvelope` | 未实现 | 计划中的 RAW_ENVELOPE 暴露点 | Phase 7.7 白盒附加验证（默认不计主流程） |

**使用前提：** 从 `/create` 走完 wizard 到 `/create/gas`，保持 CreateSoulProvider context 完整（name + description + coverImageFile + charFile + memoryFile 非空）。

> **Grant 管理已迁移到 GrantModal UI**：Phase 5 不再需要导航到 gas 页。Grant 发放/撤销通过 My Souls 页的 GrantModal 组件（`new-web/components/souls/grant-modal.tsx`）直接完成，使用 `useGrant` hook 调用链上 TX。

---

## 关键文件

### 前端页面
| 文件 | 用途 |
|------|------|
| `new-web/app/market/page.tsx` | Market 列表页 — Phase 0, 1.10, 2.6, 4.3 |
| `new-web/app/souls/[id]/page.tsx` | Soul 详情页 — Phase 1.8-1.9, 5.1, 6 |
| `new-web/app/souls/[id]/buy/page.tsx` | Buy 页 — Phase 4.4-4.5 |
| `new-web/app/souls/[id]/sell/page.tsx` | Sell 设价页 — Phase 2.1, 2.4 |
| `new-web/app/souls/[id]/sell/authorize/page.tsx` | Sell 签名页 — Phase 2.2, 2.5 |
| `new-web/app/souls/[id]/sell/success/page.tsx` | Sell 成功页 — Phase 2.3 |
| `new-web/app/create/page.tsx` | 创建 Step 1 — Phase 1.2 |
| `new-web/app/create/content/page.tsx` | 创建 Step 2 — Phase 1.3 |
| `new-web/app/create/preview/page.tsx` | 创建 Step 3 — Phase 1.4 |
| `new-web/app/create/gas/page.tsx` | 创建 Step 4 + E2E helpers — Phase 1.5-1.6 |
| `new-web/app/create/success/page.tsx` | 创建成功 — Phase 1.6 |
| `new-web/app/collections/create/page.tsx` | Collection Step 1 — Phase 3.1 |
| `new-web/app/collections/create/souls/page.tsx` | Collection Step 2 — Phase 3.2 |
| `new-web/app/collections/create/preview/page.tsx` | Collection Step 3 — Phase 3.3 |
| `new-web/app/import/page.tsx` | Import Step 1 — Phase 8.1 |
| `new-web/app/import/map/page.tsx` | Import Map — Phase 8.2 |
| `new-web/app/import/preview/page.tsx` | Import Preview — Phase 8.3 |
| `new-web/app/import/gas/page.tsx` | Import Gas — Phase 8.4 |
| `new-web/app/my-souls/page.tsx` | My Souls 5-tab + GrantModal — Phase 1.11, 4.3a-c, 4.6, 5.2, 5.5, 5.6 |
| `new-web/app/resources/content-format/page.tsx` | Content Format 参考 — Phase 10.2 |
| `new-web/app/resources/getting-started/page.tsx` | Getting Started — Phase 10.2 |
| `new-web/app/resources/stats/page.tsx` | Protocol Stats — Phase 10.5 |
| `new-web/app/community/leaderboard/page.tsx` | Leaderboard — Phase 10.4 |
| `new-web/app/community/u/[spaceId]/page.tsx` | Community Profile + Follow — Phase 10.6 |
| `new-web/components/nav/navbar.tsx` | 导航栏 + Login |
| `new-web/components/nav/account-button.tsx` | 账户下拉 + Sign Out |
| `new-web/components/providers/auth-provider.tsx` | Privy auth context |
| `new-web/components/souls/grant-modal.tsx` | GrantModal UI — Phase 5.2, 5.6 |
| `new-web/components/souls/memory-panel.tsx` | Memory Panel — Phase 1.8, 6.3 |

### 前端 Hooks
| 文件 | 用途 |
|------|------|
| `new-web/lib/hooks/use-publish.ts` | Publish hook — Phase 1.6-1.7 |
| `new-web/lib/hooks/use-purchase.ts` | Purchase hook — Phase 4.5 |
| `new-web/lib/hooks/use-list-soul.ts` | List hook — Phase 2.2, 2.5 |
| `new-web/lib/hooks/use-grant.ts` | Grant hook — Phase 5.2, 5.6（via GrantModal） |
| `new-web/lib/hooks/use-skills.ts` | Skills hook — Phase 6 |
| `new-web/lib/hooks/use-social.ts` | Bookmark/Follow hooks — Phase 4.3a-c, 10.6 |
| `new-web/lib/hooks/use-collection-publish.ts` | Collection publish — Phase 3.3 |
| `new-web/lib/hooks/use-import.ts` | Import hook — Phase 8.4 |
| `new-web/components/souls/skills-panel.tsx` | Skills 面板 UI — Phase 6 |

### Agent API（已实现 ✅）
| 文件 | 用途 |
|------|------|
| `new-web/lib/soulidity/agent-server.ts` | Agent auth 中间件 `requireAgentWalletIdentity` |
| `new-web/lib/soulidity/coin-selection.ts` | Coin 选择工具 |
| `new-web/app/api/agent/souls/search/route.ts` | Agent 搜索 listed Soul |
| `new-web/app/api/agent/souls/[id]/route.ts` | Agent Soul 详情 + 报价 |
| `new-web/app/api/agent/souls/[id]/access/route.ts` | Agent Seal 访问 |
| `new-web/app/api/agent/souls/[id]/purchase/route.ts` | Agent 准备购买 TX |
| `new-web/app/api/agent/souls/[id]/purchase/execute/route.ts` | Agent 执行购买 TX + mirror |
| `new-web/app/api/agent/souls/[id]/skills/[skillName]/versions/[versionIndex]/access/route.ts` | Agent Skills Seal 访问 |
| `new-web/app/api/agent/souls/[id]/memory/[entryKey]/access/route.ts` | Agent Memory Seal 访问 |
| `tests/new-web/soulidity-agent-server.test.ts` | Auth 中间件单元测试 |

### E2E 脚本（已实现 ✅）
| 文件 | 用途 |
|------|------|
| `new-web/scripts/e2e-agent-purchase.ts` | Agent 购买（prepare → local sign → execute → verify access） |
| `new-web/scripts/e2e-agent-decrypt.ts` | Agent Seal 解密（SHA-256 hash 校验） — Phase 7.6 |
| `new-web/scripts/e2e-agent-verify-content.ts` | Seal 内容逐字节比对（与原始文件 MD5 对比） — Phase 7.7 |

### Soulidity SDK
| 文件 | 用途 |
|------|------|
| `new-web/lib/soulidity/access.ts` | Seal 访问逻辑（`resolveSoulAccessPayload`） |
| `new-web/lib/soulidity/repository.ts` | Soul 查询 + 序列化 |
| `new-web/lib/soulidity/queries.ts` | 链上读取 + 报价 |
| `new-web/lib/soulidity/tx/buy.ts` | 购买 TX builder |
| `new-web/lib/soulidity/tx/publish.ts` | 发布 TX builder |
| `new-web/lib/soulidity/personal-kiosk.ts` | Personal kiosk 解析 |
| `new-web/lib/soulidity/mirror/` | Post-TX DB 镜像同步 |
| `new-web/lib/soulidity/events.ts` | TX 事件提取 |
| `new-web/lib/soulidity/upload-validation.ts` | 文件上传验证（MIME, 签名, 大小, skill bundle） |
| `new-web/lib/soulidity/content-schema.ts` | Content 验证 schema |
| `new-web/lib/soulidity/content-templates.ts` | soul.md / memory.md / skill.md 模板 |
| `new-web/lib/soulidity/object-inputs.ts` | On-chain object input helpers |

### Legacy Auth（通过 `@web/*` alias 引用）
| 文件 | 用途 |
|------|------|
| `web/lib/auth/resolve-agent.ts` | `resolveAgentByApiKey` — API key SHA-256 → AgentIdentity |
| `web/lib/auth/sui-wallet.ts` | `getMemberSuiWalletAddresses` — Agent 钱包解析 |
| `web/lib/rate-limit.ts` | `takeRateLimitToken` — IP/member rate limiting |
| `web/lib/sui.ts` | `suiClient` — Sui RPC 客户端 |
| `web/lib/prisma.ts` | `prisma` — 共享 Prisma 客户端 |

### Collection 批量处理
| 文件 | 用途 |
|------|------|
| `new-web/app/collections/create/souls/batch-utils.ts` | `processFolderUpload` — 解析 xlsx + 编号子文件夹 |
| `new-web/components/providers/create-collection-provider.tsx` | Collection state: batchSouls, soulFolders, publishResult |

---

## 已知风险与缓解

1. **创建向导状态隔离**: CreateSoulProvider 通过 React context 维护跨页面状态。Gas 页有守卫 — `missingStep1`/`missingStep2` 时 redirect。测试必须从 Step 1 顺序走到 Gas 页。
2. **Agent API 已完成 ✅**: 2026-04-03 实现，6 个路由 + auth 中间件 + 单元测试。
3. **Privy iframe selectors**: Privy 注入自己的 iframe，内部 selector 需运行时通过 `evaluate_script` 查询。
4. **Rate limit**: 本地 dev 用内存 rate limiter，正常测试不触发。
5. **Agent auth 复用 legacy 代码 ✅**: `@web/lib/auth/resolve-agent` 等通过 `@web/*` alias 正常导入。
6. **Coin selection 隔离约束**: 已复制为独立的 `new-web/lib/soulidity/coin-selection.ts`。
7. **Agent 购买两步签名 TTL**: prepare 到 execute 之间有 10 分钟窗口，超时返回 410。
8. **E2E 脚本已完成 ✅**: `e2e-agent-purchase.ts` 和 `e2e-agent-decrypt.ts`。
9. **Collection directory upload 模拟**: Chrome DevTools MCP `upload_file` 无法直接模拟 `webkitdirectory` picker，需通过 `evaluate_script` 构造 File 对象 + DataTransfer + dispatch change event。
10. **Import 字段映射**: `soul.md` 作为 source file 时，name/description 可能无法自动映射，需手动填写 — 这恰好测试了 manual fallback 路径。
11. **Memory Panel smoke**: Phase 6.3 改为渲染 smoke test，不做 append 操作。Memory append 需要未来补 `__e2eAppendMemory` helper。
12. **Seal 内容比对依赖**: Phase 7.7 需要 gas 页暴露 `window.__e2eLastRawEnvelope`（1 行代码改动），且需要 `SOUL_UPLOAD_SECRET` 环境变量。
13. **Follow 测试依赖**: Phase 10.6 需要在 Phase -1.2 记录 `SELLER_MEMBER_ID`。
14. **Bookmark 时序**: Phase 4.3a-4.3c 必须在 Buyer 登录后、购买前执行（两个 Soul 均 listed 时 market 才有 bookmark 按钮）。
15. **Admin 面板未覆盖**: 7 个 admin 页面 + 11 个 admin API 路由不在本轮测试范围（无 admin 测试账号）。
16. **Sui CLI 可用性**: 依赖本地 `sui` >= 1.69.0 + testnet RPC。RPC 超时可重试；若 CLI 未安装则 Phase -1 立即阻塞。验证：`which sui && sui --version`。
17. **USDC Treasury Cap 归属**: `sui client call` mint USDC 要求 `active-address` 为 treasury owner（`0x76fd52cac79bda80806be6b5ab7f3b1f099a966203cce809254919a7ab755728`）。若当前不是，需先 `sui client switch --address`。
18. **Agent 地址动态发现前提**: DB 必须已有 agent 的 `wallet_bindings` 记录。若无，需先运行 `npx tsx scripts/e2e-setup-agents.ts`。

---

## 验证标准

默认验收口径：
- 72 项主流程通过
- 1 项外部依赖验证（Phase 7.6）单独记录，通过则加分，失败记为 external-blocked
- 1 项白盒附加验证（Phase 7.7）默认不计入 E2E 主流程通过率
- Phase 5 全部走 GrantModal UI（不依赖 gas 页 `__e2e*` 函数）
- Phase 6.3 改为 Memory Panel 渲染 smoke（不需要 `__e2eAppendMemory`）
- Phase 7.7 Seal 内容比对仅在补出 `__e2eLastRawEnvelope` 后执行
- 截图存档到 `docs/e2e-screenshots/`
- 测试结果更新到 `docs/e2e-test-results-new-web.md`
- Phase 11 cleanup 完成后 market 恢复空状态，DB 无残留（含 follows + bookmarks 表）
