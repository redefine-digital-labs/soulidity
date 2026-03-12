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
