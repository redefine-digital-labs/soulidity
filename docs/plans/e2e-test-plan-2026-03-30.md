# Soul Marketplace E2E Test Plan — Chrome DevTools MCP

## Context

v6 kiosk rewrite 完成后需要全流程 E2E 验证。上次测试 28/30 通过，#24-25（Seal 解密）因脚本错误失败。

v6.1 新增功能（2026-03-31）：
- **Mint-only publish**：发布 Soul 时可不上架（`listForSale` checkbox）
- **Cancel listing (delist)**：已上架 Soul 可取消上架，回到 held 状态
- **List from detail page**：held 状态 Soul 可从详情页设价上架

本次目标：
1. 清空 DB 中所有旧 Soul 开发数据
2. 用 Chrome DevTools MCP 全自动跑 36 项测试（仅 2 次 Privy OTP 需手动输入）
3. 一次做完，不留尾巴

## 测试账号

| 角色 | 邮箱 | Wallet |
|------|------|--------|
| Seller | ithinco@gmail.com | `0x858d...eb82` |
| Buyer | tenxhunter@gmail.com | `0xb9ed...614c` |
| Agent Alpha | API key `sk-ea27...4f` | `0x3b82...8610` |
| Agent Beta | API key `sk-c264...c3` | `0x7ef4...8790` |

---

## Phase -1: 环境准备

### -1.1 清空 DB Soul 数据
```sql
DELETE FROM "soul_prepared_purchases";
DELETE FROM "soul_tx_syncs";
DELETE FROM "soul_assets";
```
通过 `npx prisma db execute` 或直接连 DB 执行。不清 members/wallet_bindings。

### -1.2 验证测试账号存在
查 DB 确认 Seller/Buyer member + wallet_binding 存在，Agent Alpha/Beta 有 API key。

### -1.3 验证钱包余额
用 Sui RPC 检查：
- Seller: ≥0.1 SUI gas
- Buyer: ≥0.1 SUI gas + ≥2 test USDC
- Agent Alpha: ≥0.1 SUI gas + ≥3 test USDC

### -1.4 准备测试文件
创建最小测试文件供 publish 上传：
- 1x1 PNG 图片（preview image，通过 `UploadWalrus` 组件上传）
- 小文本文件（content bundle，本地选择后由 publish 流程自动加密上传）

### -1.5 确认 Next.js dev server 运行
`curl http://localhost:3000/souls` 确认可达。

### -1.6 清空浏览器 localStorage 旧 draft
navigate 到 `/souls/publish` 后 `evaluate_script` 清除所有 `soul-publish-draft:*` key。

---

## Phase 0: Pre-flight（3 tests）

### 0.1 页面加载
- `navigate_page` → `http://localhost:3000/souls`
- `wait_for` text "Soul Market"
- `evaluate_script` 验证 `document.querySelector('a[href="/souls/publish"]')` 存在且含 "Publish Soul"

### 0.2 空状态验证
- `evaluate_script` 验证 `input[placeholder="Search Souls"]` 存在
- `evaluate_script` 验证页面含 "No Souls listed right now."

### 0.3 截图
- `take_screenshot` 存档

---

## Phase 1: Seller 发布（10 tests）

### Test 1: Seller 登录（手动 OTP）
1. `navigate_page` → `http://localhost:3000/login`
2. `wait_for` text "邮箱登录"
3. `click` "邮箱登录" 按钮（selector: `#login-tabpanel-human button.btn-primary`）
4. Privy 弹出邮箱输入 modal — 在 Privy iframe 中 fill email `ithinco@gmail.com` 并提交
5. **暂停等用户输入 OTP** — `wait_for` nav 中出现用户头像（selector 判断：nav 中不再有 `a[href="/login"]`），timeout 120s
6. 验证：`evaluate_script` 确认 nav 中无 "登录" 链接

### Test 2: 发布 Soul A — mint + 直接上架（$1, 5% royalty）
1. 清 localStorage draft: `evaluate_script` → `Object.keys(localStorage).filter(k=>k.startsWith('soul-publish-draft:')).forEach(k=>localStorage.removeItem(k))`
2. `navigate_page` → `/souls/publish`
3. `wait_for` text "Mint a Soul"
4. 验证 "List for sale immediately" checkbox 默认勾选（`evaluate_script` → `document.querySelector('input[type="checkbox"]').checked === true`）
5. 填表单（用 `fill` + CSS selector）:
   - Name: `E2E Kiosk Alpha v6`
   - Description: `E2E test Soul A - Trading strategy content`
   - Category: `Trading`
   - Price USDC: `1`
   - Creator royalty bps: `500`
   - Tags: `alpha, e2e, trading`
   - README: `E2E test Soul A readme`
6. Preview image 上传 + Content file 选择（同旧流程）
7. `click` "Publish Soul" → 等待 on-chain TX + 镜像同步
8. `wait_for` URL 变为 `/souls/0x...`，timeout 60s
9. **记录 SOUL_A_ID**
10. `take_screenshot`

### Test 3: 发布 Soul B — mint-only，不上架
1. 清 localStorage draft
2. `navigate_page` → `/souls/publish`
3. `wait_for` text "Mint a Soul"
4. **取消勾选** "List for sale immediately" checkbox（`click` checkbox）
5. `evaluate_script` 验证 checkbox 未勾选
6. 验证价格输入区域隐藏，helper text 显示 "Your Soul will be minted and held in your kiosk"
7. 填表单:
   - Name: `E2E Kiosk Beta v6`
   - Description: `E2E test Soul B - Research content`
   - Category: `Research`
   - Tags: `beta, e2e, research`
   - README: `E2E test Soul B readme`
   - （无需填 Price/Royalty — 区域已隐藏）
8. Preview image 上传 + Content file 选择
9. `click` "Publish Soul" → 等待 on-chain TX（调用 `mint_to_kiosk`/`mint_in_personal_kiosk`）
10. `wait_for` URL 变为 `/souls/0x...`，timeout 60s
11. **记录 SOUL_B_ID**
12. `take_screenshot`

### Test 4: Soul A 状态 = Listed
- `navigate_page` → `/souls/${SOUL_A_ID}`
- `wait_for` Soul name 显示
- `evaluate_script` 验证页面含 "Listed"（cyan 色）
- `evaluate_script` 验证 price 区域显示格式化金额（非 "Not for sale"）

### Test 5: Soul B 状态 = Held（未上架）
- `navigate_page` → `/souls/${SOUL_B_ID}`
- `wait_for` Soul name 显示
- `evaluate_script` 验证页面含 "Held"（emerald 色）
- `evaluate_script` 验证 price 区域显示 "Not for sale"
- `evaluate_script` 验证 Owner management 面板存在（`soul.isOwner && listingStatus === 'held'`）
- `take_screenshot`

### Test 6: 从详情页上架 Soul B（$2, list_fixed_price）
- 在 Soul B 详情页，展开 Owner management 面板
- `fill` price input（`input[aria-label="Price in USDC for listing"]`）: `2`
- `click` "List for sale"（`button[aria-label="List this Soul for sale"]`）
- 等待 Privy TX 签名（`buildListHeldSoulTx` → `list_fixed_price` → 镜像 `/api/souls/publish`）
- `wait_for` 状态变为 "Listed"
- `evaluate_script` 验证 price 显示格式化金额
- `take_screenshot`

### Test 7: 取消上架 Soul B（cancel_listing → 回到 Held）
- 在 Soul B 详情页，验证 "Cancel listing" 按钮可见（`button[aria-label="Cancel Soul listing"]`）
- `click` "Cancel listing"
- 等待 Privy TX 签名（`buildCancelListingTx` → `cancel_listing` → 镜像 `/api/souls/{id}/delist`）
- `wait_for` 状态变为 "Held"
- `evaluate_script` 验证 price 显示 "Not for sale"
- `evaluate_script` 验证 Owner management 面板重新出现
- `take_screenshot`

### Test 8: 重新上架 Soul B（$2）
- 重复 Test 6 流程（`fill` $2 → "List for sale" → 等待 Listed）
- 验证状态 = "Listed"

### Test 9: 列表页显示 2 个 Soul（均 Listed）
- `navigate_page` → `/souls`
- `wait_for` 2 个 SoulCard 出现
- `evaluate_script` 验证页面包含 "E2E Kiosk Alpha v6" 和 "E2E Kiosk Beta v6"

### Test 10: My Souls — Authored 2, Owned 2
- `navigate_page` → `/souls/my`
- `wait_for` "My Souls" heading
- `evaluate_script` 验证：
  - "Authored" section 下有 2 个 card
  - "Owned" section 下有 2 个 card

---

## Phase 2: Buyer 购买（5 tests）

### Test 11: Buyer 登录（手动 OTP）
1. 登出 Seller：
   - `click` nav 右侧用户头像按钮
   - `wait_for` dropdown 出现
   - `click` "退出登录" 按钮
   - `wait_for` nav 出现 "登录" 链接
2. `navigate_page` → `/login`
3. `click` "邮箱登录"
4. Privy modal 填 `tenxhunter@gmail.com`
5. **暂停等用户输入 OTP** — timeout 120s
6. 验证登录成功

### Test 12: Personal Kiosk 初始化
- `navigate_page` → `/souls/${SOUL_A_ID}`
- `wait_for` 购买按钮区域加载
- Personal kiosk 状态自动检查（组件 mount 时 `useEffect` 调用 `GET /api/souls/personal-kiosk`）
- 如果出现 "Initialize Soul kiosk" 按钮（`personalKioskStatus === 'missing'`）→ `click` 并等 Privy 签名
- `wait_for` 按钮变为 "Buy for ..."（kiosk 初始化后 `personalKioskStatus` 变为 `'ready'`）
- 如果直接显示 "Buy for ..." → kiosk 已就绪，跳过

### Test 13: 购买 Soul A
- `click` "Buy for ..." 按钮
- 等待 Privy TX 签名（coin selection + `buildBuySoulTx` + signAndExecute + POST `/api/souls/{id}/purchase` 镜像同步）
- `wait_for` "You currently own this Soul." 文本出现（页面 refetch 后 `soul.isOwner === true`）
- `take_screenshot`

### Test 14: Owner UI 完整
- `evaluate_script` 验证存在：
  - **Access content 区域**：`button[aria-label="Download Soul content"]`
  - **Owner management 面板**（`soul.isOwner && soul.listingStatus === 'held'`）：
    - List for sale: `input[aria-label="Price in USDC for listing"]` + `button[aria-label="List this Soul for sale"]`
    - Manage allowlist: `input[aria-label="Sui address for allowlist"]` + `button[aria-label="Add address to Soul allowlist"]`

### Test 15: My Souls — Authored 0, Owned 1
- `navigate_page` → `/souls/my`
- `evaluate_script` 验证：
  - Authored: "You have not published any Souls yet."
  - Owned: 1 个 card

---

## Phase 3: Owner 操作（7 tests）

### Test 16: 设置 allowlist for Agent Alpha
- `navigate_page` → `/souls/${SOUL_A_ID}`
- `fill` allowlist input（`input[aria-label="Sui address for allowlist"]`）: `0x3b82a2209ab7f937d29c12105fe501a63f4223a7f5c128842d25686e66a68610`
- `click` "Add to allowlist"（`button[aria-label="Add address to Soul allowlist"]`）
- 等待 Privy TX 签名
- `wait_for` "Current allowlist address" 文本
- `take_screenshot`

### Test 17: Agent Alpha → Soul A: 200（allowlisted）
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f" \
  http://localhost:3000/api/agent/souls/${SOUL_A_ID}/access
```
验证 HTTP 200 + response 含 `seal_approve_allowlisted`

### Test 18: Agent Beta → Soul A: 403
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer sk-c264016082af57dda7a64f15bb9219f2507d398ac56d66c3" \
  http://localhost:3000/api/agent/souls/${SOUL_A_ID}/access
```
验证 HTTP 403

### Test 19: 清除 allowlist + confirm dialog
- ConfirmModal 弹出 — `click` confirm 按钮
- `click` "Clear allowlist"（`button[aria-label="Clear Soul allowlist"]`）
- 等待 Privy TX 签名
- `wait_for` allowlist input 重新出现
- `take_screenshot`

### Test 20: Agent Alpha revoked → 403
同 Test 17 的 curl，验证 HTTP 403

### Test 21: 重新设置 allowlist for Alpha
重复 Test 16 完整流程

### Test 22: Owner 下载内容
- `click` "Download content"（`button[aria-label="Download Soul content"]`）
- 等待 Privy personal message 签名（Seal 解密流程）
- `wait_for` 按钮从 "Decrypting…" 恢复
- `list_console_messages` 验证无 error

---

## Phase 4: Agent 自购 + 交叉验证（4 tests）

### Test 23: Agent Alpha 购买 Soul B
使用现有脚本 `web/scripts/e2e-agent-purchase.ts`：
```bash
cd /Users/admin/Desktop/nao/clawnews && \
SOUL_ID=${SOUL_B_ID} \
AGENT_API_KEY=sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f \
npx tsx web/scripts/e2e-agent-purchase.ts
```
验证脚本输出含 TX digest 且退出码 0

### Test 24: Alpha → Soul B: 200（owner）
```bash
curl -s http://localhost:3000/api/agent/souls/${SOUL_B_ID}/access \
  -H "Authorization: Bearer sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f"
```
验证 200 + `seal_approve_owner_in_personal_kiosk`

### Test 25: 交叉验证矩阵
4 个 curl 调用验证：

| Agent | Soul A | Soul B |
|-------|--------|--------|
| Alpha | 200 (allowlisted) | 200 (owner) |
| Beta | 403 | 403 |

### Test 26: Owner vs Allowlisted policy 差异
- Alpha→A: `seal_approve_allowlisted`
- Alpha→B: `seal_approve_owner_in_personal_kiosk`
两者不同 → Pass

---

## Phase 5: Seal 解密验证（2 tests）

### Test 27: 浏览器 Owner 解密 Soul A
已在 Test 22 执行。此处追加验证：
- `list_network_requests` 找 `/api/souls/${SOUL_A_ID}/access` 请求
- `get_network_request` 检查 response body 含 `sealSidecar` 字段
- 验证 response 含 `accessKind`（`'owner'`）和 `accessPolicy.functionName`（`'seal_approve_owner_in_personal_kiosk'`）
- 验证下载过程中无 console error

### Test 28: Agent 脚本解密 Soul B
```bash
SOUL_ID=${SOUL_B_ID} \
AGENT_API_KEY=sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f \
npx tsx web/scripts/e2e-agent-decrypt.ts
```

---

## Phase 6: Hardening（5 tests）

全部通过 curl 验证 Agent API 边界：

### Test 29: Invalid API key → 401
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer sk-invalid-000000" \
  http://localhost:3000/api/agent/souls/${SOUL_A_ID}/access
```

### Test 30: No auth header → 401
```bash
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3000/api/agent/souls/${SOUL_A_ID}/access
```

### Test 31: Soul not found → 404
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f" \
  http://localhost:3000/api/agent/souls/0x0000000000000000000000000000000000000000000000000000000000000000/access
```

### Test 32: No permission → 403
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer sk-c264016082af57dda7a64f15bb9219f2507d398ac56d66c3" \
  http://localhost:3000/api/agent/souls/${SOUL_A_ID}/access
```

### Test 33: Malformed Soul ID → 404
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f" \
  http://localhost:3000/api/agent/souls/0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF/access
```

---

## 手动介入点（仅 2 次）

1. **Test 1** — Seller OTP（`ithinco@gmail.com` 邮箱验证码）
2. **Test 11** — Buyer OTP（`tenxhunter@gmail.com` 邮箱验证码）

Privy embedded wallet 签名应自动完成，无需手动 approve。

## 状态依赖链

```
Phase -1 (cleanup) → Phase 0 (pre-flight)
Test 1 (seller login) → Tests 2-10
Test 2 (publish Soul A, mint+list) → SOUL_A_ID → 所有后续
Test 3 (publish Soul B, mint-only) → SOUL_B_ID → 所有后续
Tests 5-6 (verify held/listed status)
Test 6 (list Soul B from detail) → Test 7
Test 7 (cancel listing Soul B) → Test 8
Test 8 (re-list Soul B) → Tests 9-10, Phase 2+
Test 11 (buyer login) → Tests 12-22
Test 13 (purchase) → Tests 14-22
Test 16 (set allowlist) → Tests 17-18
Test 19 (clear) → Test 20
Test 21 (re-set) → Tests 22, 25 (Alpha→A=200)
Test 23 (agent purchase) → Tests 24-26, 28
```

## 关键文件

| 文件 | 用途 |
|------|------|
| `web/app/souls/page.tsx` | 列表页 — Phase 0, Test 4 |
| `web/app/souls/[id]/page.tsx` | 详情页 — Phase 1-3 所有 |
| `web/app/souls/publish/page.tsx` | 发布页 — Test 2-3 |
| `web/app/souls/my/page.tsx` | My Souls — Test 5, 12 |
| `web/app/login/page.tsx` | 登录页 — Test 1, 8 |
| `web/components/public-nav.tsx` | 导航栏登录状态 |
| `web/components/souls/access-download-button.tsx` | 下载按钮 — Test 19, 24 |
| `web/components/souls/purchase-button.tsx` | 购买按钮 — Test 9-10 |
| `web/components/souls/upload-walrus.tsx` | Preview 文件上传 — Test 2-3 |
| `web/app/api/souls/personal-kiosk/route.ts` | Personal kiosk 查询 — Test 9 |
| `web/app/api/souls/[id]/access/route.ts` | 人类 access 端点 — Test 19, 24 |
| `web/app/api/souls/[id]/allowlist/route.ts` | Allowlist CRUD — Test 16, 19, 21 |
| `web/app/api/souls/[id]/delist/route.ts` | 取消上架镜像同步 — Test 7 |
| `web/app/api/souls/[id]/purchase/route.ts` | 购买镜像同步 — Test 13 |
| `web/app/api/agent/souls/[id]/access/route.ts` | Agent access — Test 14-15, 21-22, 26-30 |
| `web/lib/souls/tx-builder.ts` | TX 构建（mint, mint-only, buy, list, cancel, allowlist） |
| `web/lib/souls/access-download.ts` | 浏览器端解密下载逻辑 |
| `web/lib/souls/access.ts` | 服务端 access payload 构建 |
| `web/lib/souls/personal-kiosk.ts` | Personal kiosk 解析 |
| `web/lib/souls/on-chain-verification.ts` | 链上状态验证 |
| `web/lib/souls/soul-detail-utils.ts` | 详情页工具（allowlist cap 提取） |
| `move/soul_object/sources/allowlist.move` | Allowlist Move 模块 |
| `move/soul_object/sources/market.move` | 市场 Move 模块 |
| `web/scripts/e2e-agent-purchase.ts` | Agent 购买脚本 — Test 20 |
| `web/scripts/e2e-agent-decrypt.ts` | Agent 解密脚本 — Test 25（可能需修复） |
| `prisma/schema.prisma` | DB schema — Phase -1 cleanup |

## 验证标准

全部 33 项测试通过，截图归档到 `docs/legacy/e2e-screenshots/`，测试结果更新到 `docs/legacy/e2e-test-results-2026-03-31.md`。

## 新增测试覆盖（v6.1）

| 测试 | 功能 | 验证点 |
|------|------|--------|
| Test 3 | Mint-only publish | checkbox 取消勾选 → 价格区域隐藏 → `mint_to_kiosk` TX |
| Test 5 | Held 状态 | 未上架 Soul 显示 "Held" + "Not for sale" + Owner panel |
| Test 6 | Detail page list | 从详情页设价上架 → `list_fixed_price` → Listed |
| Test 7 | Cancel listing | 取消上架 → `cancel_listing` → 回到 Held + Owner panel 重现 |
| Test 8 | Re-list after cancel | 取消后重新上架验证完整循环 |
