# Not Issues

Date: 2026-03-12

### 2. Medium - The new replay check does not fully bind payment to the purchase intent

**Original concern**: The confirm-purchase flow accepts any transaction where the same buyer wallet sent the expected amount to the same recipient after intent creation. An unrelated post-intent transfer could theoretically be used as proof.

**Why this is not an issue**:

1. **`txDigest` uniqueness check** (line 40-43): Each transaction can only be used for one order. This is the primary replay defense and it's robust — once a txDigest is recorded, it cannot be reused.

2. **Buyer-initiated flow**: The buyer themselves submit the `txDigest`. The scenario where an "unrelated transfer" is used requires the buyer to deliberately submit a transaction they didn't intend for this purchase — effectively tricking themselves. There's no third-party attack vector.

3. **Combined checks are sufficient**: sender verification + recipient match + amount threshold + txDigest uniqueness together form a defense-in-depth that's appropriate for a marketplace MVP.

4. **No practical improvement without Move changes**: Truly binding payment to intent would require a custom Move contract with a memo/reference field. This is an architectural decision, not a bug fix.

### 6. Medium - Wallet-bind challenge expiry is client-enforced only

**Original concern**: The server never records nonce issuance time or consumption state server-side, so the "10-minute expiry" and "single-use" guarantees are not enforced independently of the browser cookie.

**Why this is not an issue for MVP**:

1. **Cookie is properly secured**: `httpOnly` (JS can't access), `secure` (HTTPS only in production), `sameSite: strict` (no CSRF), `maxAge: 600` (browser auto-expires after 10 minutes).

2. **Cookie is properly deleted on use**: After the fix in issue #1, both success paths in `confirm/route.ts` delete the cookie with the correct path, preventing reuse in standard browser flows.

3. **Replay has no security impact**: Even if an attacker replayed a nonce+signature outside the browser:
   - Same wallet + same account → returns existing binding (no-op, line 42-46)
   - Same wallet + different account → 409 conflict (line 39-41)
   - Different wallet + same nonce → signature verification fails (line 28-33)

4. **Authentication required**: The confirm endpoint requires a valid session. An attacker would need both the session cookie AND the wallet-bind-nonce cookie, at which point they already have full account access.

5. **Server-side nonce storage is a hardening improvement**: Worth adding when the wallet-bind flow protects higher-value operations (e.g., fund withdrawals), but not a bug for MVP account linking.

---

## Round 2 (2026-03-12)

（本轮审查中所有 4 个 findings 均为真实问题，已全部修复，无 not-issue。）

---

## Round 3 (2026-03-12)

### 11. Medium - `seed-market` 不能从"只建了 bundle、没建 listing"的半成品状态恢复

**Original concern**: 若某次运行在 `agentBundle.create()` 之后、`listing.create()` 之前失败，之后每次重跑都会跳过该条目，导致"有 bundle 无 listing"的坏状态。

**Why this is not an issue**:

1. **Seed 脚本是开发工具**：仅用于本地开发和测试环境填充数据，不是生产运行的代码路径。
2. **部分失败极少发生**：两个 create 调用之间没有外部 IO 或复杂逻辑，实际断裂概率极低。
3. **手动恢复成本低**：即使出现部分状态，删除孤立 bundle 或清空重跑即可解决，不需要脚本级的事务保障。
4. **过度工程**：为一次性开发工具添加完整事务恢复机制不符合实际需要。

### 12. Medium - `seed-market` 生成的可购买模板没有真实可下载的产物

**Original concern**: seed 脚本创建的 bundle 使用伪造的 `storagePath` / `contentHash`，没有对应的真实文件上传到存储桶，用户购买后下载链路无法交付。

**Why this is not an issue**:

1. **Mock 数据的设计目的**：seed 数据用于填充市场 UI 进行展示和功能测试，不是完整的端到端交易验证。
2. **下载路由有错误处理**：`download/route.ts` 在 `createSignedUrl` 失败时会返回 500 错误，不会产生安全问题或数据损坏。
3. **开发环境限定**：seed 脚本只在开发环境运行，不会影响生产用户体验。
4. **上传真实文件超出 seed 脚本职责**：为每个 mock 模板制作真实的可下载 zip 包是内容工作，不是代码缺陷。
