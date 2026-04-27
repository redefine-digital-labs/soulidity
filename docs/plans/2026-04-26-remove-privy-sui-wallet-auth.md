# Plan — Remove Privy entirely, migrate auth to Sui Wallet SDK

## Context

**Why now**: Privy embedded-wallet model conflicts with the project's "user truly owns their wallet" direction.
- Privy holds private keys server-side; users **cannot** export them.
- Privy custom-auth for Desktop is a brittle JWT relay (PRIVY_CUSTOM_AUTH_PRIVATE_KEY_PEM) tied to OAuth providers.
- Email-only Privy login (currently `loginMethods: ['email']`) creates "wallet ownership" the user can never escape from.
- Switching to wallet-connect (`@mysten/dapp-kit` + wallet-standard) makes Souls truly user-owned and removes the third-party custodian.

**Decisions** (2026-04-26):
- **Greenfield migration** — dev environment, no historical user data to preserve. Drop `privy_did` column outright; no backfill.
- **Login mechanism** — Sui wallet extensions only (Slush / Sui Wallet / Suiet via @mysten/dapp-kit). zkLogin is **out of scope** for v1.
- **Browser session security** — human web auth uses HttpOnly session cookies, but mutating browser requests must pass a first-party CSRF check. Do not turn the old `requireIdentity()` cookie fallback into a blanket mutation auth path.
- **TG bot users** — bot runtime stays unchanged. If Web receives a verified TG session/link context, wallet login must attach the wallet to the existing `tgId` account/member instead of creating a duplicate wallet-only identity; otherwise wallet login creates a normal wallet-owned account.
- **Desktop in same PR** — Desktop's Privy custom-auth gets deleted. Desktop keeps the existing `dtk_` bearer token rail for desktop API auth, and uses a local Sui keypair stored in Electron `safeStorage` only for wallet challenge / transaction signing.

**Outcome**: Browser humans authenticate through wallet-signature challenge → HttpOnly session cookie + CSRF token. Agent/API auth paths stay explicit-header based. Desktop authenticates desktop APIs with `dtk_` bearer tokens and signs wallet actions locally. No runtime `@privy-io/*` packages or Privy routes remain.

---

## Current state (from exploration)

**Server (`/web`):**
- `web/lib/auth/privy.ts` — single Privy SDK boot.
- `web/lib/auth/identity.ts` — `resolvePrivyIdentity()` (lines 339–531) verifies Privy JWT, looks up Account by `privyDid`, auto-creates Account+Member, **calls `privy.createWallets()` to provision an embedded Sui wallet** (line 222) and stores it in `WalletBinding`.
- Identity priority order (lines 533–582): wallet-sig (agents) → API key → Privy token.
- `web/lib/auth/identity.ts:682–688` — `requireIdentity()` currently rejects cookie fallback for mutating routes. The migration must replace this with an explicit browser-session+CSRF contract, not a silent cookie fallback.
- `web/lib/auth/sui-wallet.ts:41` — `getMemberPrimarySuiWalletAddress(memberId)` returns first WalletBinding address.
- `web/lib/auth/identity.ts:584–680` — `resolveWalletIdentity()` is **already production-ready** (challenge + nonce + 15-min expiry + signature verify via `verifyPersonalMessageSignature` + atomic mark-used). Today only used by agent flow (`x-agent-*` headers). This is the foundation we extend for human auth.
- `web/lib/desktop/privy-custom-auth.ts` — issues an ES256 JWT signed with `PRIVY_CUSTOM_AUTH_PRIVATE_KEY_PEM`; the JWT lets Electron renderer link a session to the user's Privy account.
- `web/app/api/desktop/auth/jwks/route.ts` — publishes the public key for Privy to verify the custom JWT.
- `web/app/api/desktop/device/*` + `web/lib/desktop/auth.ts` — desktop API auth is `Authorization: Bearer dtk_...`, validated through `DesktopProfile.desktopAccessTokenHash`. This remains the desktop API auth rail after Privy removal.

**Client (`/web`):**
- `web/components/providers/privy-provider.tsx` — `<PrivyProvider loginMethods={['email']}>` mounted at app root.
- `web/components/providers/app-providers.tsx:33–45` — `<QueryProvider>` wraps `<SuiClientProvider>` today. Keep this order because dapp-kit depends on React Query. **`<WalletProvider>` is NOT mounted** — wallet hooks (`useCurrentAccount` / `useSignTransaction` / `useSignPersonalMessage`) are not used yet.
- `web/components/providers/auth-provider.tsx` — wraps `usePrivy()` internally, but exposes `{ user, loading, logout, refresh, getAuthHeaders }`; `getAuthHeaders()` currently returns `Authorization: Bearer <Privy token>`.
- `web/lib/hooks/use-privy-sui.ts` — extracts the Privy-bound Sui wallet from `user.linkedAccounts`, signs raw hashes via `useSignRawHash()`, reconstructs serialized Sui signatures.
- `web/lib/hooks/use-generic-login.ts` / `use-require-auth.ts` — trigger Privy modal.
- `web/lib/hooks/use-purchase.ts` is only one call site. `usePrivySuiSign()` is also used by create/import/publish/assets/grant/list/collections/skills/wrap flows, so the replacement must be repo-wide before deleting the hook. **Coin/object reads (`suiClient.getCoins`) are already dapp-kit and stay unchanged.**
- `web/app/my-souls/page.tsx`, `web/app/souls/[id]/buy/page.tsx`, `web/app/desktop/link/page.tsx` — Privy gates / linking UI.

**Desktop (`/desktop/apps/desktop`):**
- `src/renderer/components/MainWindow/ExtractTab.tsx`, `LibraryTab.tsx` — wrap themselves in `<PrivyProvider>` + `<SuiClientProvider>`.
- `src/renderer/lib/hooks/use-privy-sui.ts` — same shape as web hook.
- `src/main/index.ts` stores and sends `desktopAccessToken` through `desktop-auth-store.ts`; `desktop-auth:me` / `getDesktopMe` remains the truth source for successful desktop recovery.
- `src/main/agent-wallet.ts` already uses `safeStorage` and fails closed when encryption is unavailable. Reuse that security posture for the new desktop user wallet; do not add plaintext fallback for production.

**Schema (`prisma/schema.prisma:134–148`):**
- `Account.privyDid String? @unique @map("privy_did")` — optional unique field. **NOT** referenced by any FK; safe to drop.
- `Account.tgId / email` — alternate identity columns, both optional unique.
- `Member.accountId → Account.id` — durable user identity, unaffected.
- `WalletBinding (memberId, chain='sui', address)` — already correctly modeled, single-wallet-per-chain enforced by `20260326195000_enforce_single_wallet_per_chain`.

**TG bot (`src/bot/`):** No Privy references. Unchanged.

---

## Approach

### Server side — replace Privy verify with session cookie + wallet challenge + CSRF guard

**New auth flow** (humans):
1. Client opens Web → `<WalletProvider>` (newly mounted) renders dapp-kit wallet selection.
2. User connects wallet → `useCurrentAccount()` returns the selected wallet account; use `account.address` as the identity address. Do not read address/publicKey from `useCurrentWallet()`.
3. Client `POST /api/auth/wallet-challenge` with `{ address }` → server creates `WalletChallenge` row (reuse existing table), returns `{ nonce, message, expiresAt }`.
4. Client `useSignPersonalMessage()` → user signs `message`.
5. Client `POST /api/auth/wallet-login` with `{ address, signature, nonce }` plus optional verified TG context → server:
	   - Verifies signature via existing `verifyPersonalMessageSignature` (web/lib/auth/identity.ts:637 path).
	   - Reconstructs the expected challenge message from `WalletChallenge.domain/address/nonce/expiresAt`; reject if nonce/address/domain do not match.
	   - Marks challenge used.
	   - If the request includes a verified TG web context, finds the existing `Account.tgId` or pending `Member.tgId` and attaches this wallet to that identity. This is the only TG merge path.
	   - Otherwise finds the existing wallet owner via `Account.walletAddress` / `WalletBinding(chain='sui', address)`, or creates a new wallet-owned `Account` + human `Member`.
	   - Rejects with `409` if the wallet address is already bound to a different member/account.
	   - Upserts `WalletBinding(memberId, chain='sui', address, isPrimary=true)` and keeps `Account.walletAddress` in sync.
	   - Issues a session JWT (signed with `AUTH_SECRET`, payload `{ memberId, accountId, kind: 'human', walletAddress, csrfHash, exp }`) and sets:
	     - `session` — HttpOnly, Secure in production, SameSite=Lax, Path=/.
	     - `csrf-token` — non-HttpOnly, Secure in production, SameSite=Lax, Path=/.
6. Subsequent browser requests carry the cookie. Server reads `session` → `resolveSessionCookie()` → returns Identity. Mutating requests must also send `x-csrf-token` matching the session's `csrfHash`.

**Identity priority order (new)** in `web/lib/auth/identity.ts`:
1. Wallet-sig headers (`x-agent-address` / `x-agent-signature`) — agent path, unchanged.
2. API key (`Authorization: Bearer sk-...`) — agent path, unchanged.
3. **Session cookie** (`session` cookie) — browser humans. Accepted for read/personalization requests directly; accepted for mutating requests only through the central CSRF guard.

**Mutation auth contract**:
- Add a central helper such as `requireBrowserOrHeaderIdentity(request)` or change `requireIdentity()` to receive `Request` context. It must distinguish:
  - explicit header auth (`x-agent-*` / `Authorization: Bearer sk-*`) — unchanged, no CSRF.
  - browser session cookie — require valid `session`, valid `x-csrf-token`, and `Origin` / `Referer` host matching the trusted app domain or request host. Do not globally require JSON content type; upload routes must explicitly allow their expected content types while still enforcing CSRF.
- Update every mutating route that currently calls `requireIdentity()` so it passes the `Request` object into the new helper. Do not leave a no-argument mutation helper that accepts cookies.
- `resolveIdentity()` can keep a read-only cookie path for `/api/auth/me`, public personalization, and GET endpoints.

`resolvePrivyIdentity()`, `syncSuiWalletBinding()` (Privy bits), and the cookie fallback for legacy Privy tokens are deleted.

**Account.walletAddress denormalization**:
- Add `Account.walletAddress String? @unique @map("wallet_address")` for fast lookup at login (avoids JOIN to WalletBinding).
- Set during wallet-login. Kept in sync with the primary WalletBinding. `WalletBinding` remains the authorization truth for asset access; `walletAddress` is a lookup cache and must never disagree with the primary Sui binding.

**Reuse**:
- Existing `WalletChallenge` table + `verifyPersonalMessageSignature` chain (web/lib/auth/identity.ts:584–680). There is no current public challenge route, so add a shared `issueWalletChallenge(address, purpose)` helper and use it from the new human route and any future agent challenge route.
- `Member` and `Account` model — only `privyDid` column dropped.

### Client side — replace PrivyProvider + Privy hooks with dapp-kit wallet adapter

**New providers** (`web/components/providers/app-providers.tsx`):
```tsx
<QueryProvider>
  <SuiClientProvider networks={...} defaultNetwork={...}>
    <WalletProvider autoConnect={true}>    {/* NEW: dapp-kit wallet adapter */}
      <AuthProvider>                        {/* rewritten: backed by /api/auth/me + cookie */}
        <ToastProvider>
          {children}
```

**New hooks** (replace `use-privy-sui.ts`):
- `web/lib/hooks/use-wallet-sign.ts` — wraps dapp-kit's `useCurrentAccount` + `useSignTransaction` + `useSignPersonalMessage` + `useSuiClient`. Returns the same practical surface old callers need: `{ suiWallet, signAndExecute(tx), signPersonalMessage(msg), suiClient }`, where `suiWallet.address` is `currentAccount.address`.
- `web/lib/hooks/use-login.ts` (replaces `use-generic-login.ts`) — opens dapp-kit connect UI (`ConnectModal` / wallet-standard connect flow), runs challenge → login → refreshes auth state.
- `web/lib/hooks/use-require-auth.ts` — keeps the same surface, internally calls `use-login`.

**Auth context** (`web/components/providers/auth-provider.tsx`):
- New shape should preserve current caller needs: `{ user, loading, authenticated, logout(), refresh(), getAuthHeaders() }`. `getAuthHeaders()` no longer returns `Authorization`; it returns `{ 'x-csrf-token': csrfToken }` when a session cookie exists.
- Polls `/api/auth/me` once on mount; updates on wallet connect / disconnect events.
- `logout()` → `POST /api/auth/logout` with CSRF header → clears `session` + `csrf-token` cookies and disconnects dapp-kit.

**All web signing flows**:
- Replace every `usePrivySuiSign()` import, not just purchase. Known runtime call sites include:
  - `web/app/create/gas/page.tsx`
  - `web/app/wrap-link/personal/page.tsx`
  - `web/app/wrap-link/personal/configure/page.tsx`
  - `web/lib/hooks/use-assets.ts`
  - `web/lib/hooks/use-purchase.ts`
  - `web/lib/hooks/use-publish.ts`
  - `web/lib/hooks/use-import.ts`
  - `web/lib/hooks/use-list-soul.ts`
  - `web/lib/hooks/use-grant.ts`
  - `web/lib/hooks/use-collections.ts`
  - `web/lib/hooks/use-skills.ts`
  - `web/lib/hooks/use-wrap-publish.ts`
  - `web/lib/hooks/use-collection-publish.ts`
- `use-wallet-sign.ts` should sign with `useSignTransaction().mutateAsync({ transaction: tx })`, then execute with the existing `suiClient.executeTransactionBlock({ transactionBlock: bytes, signature })` pattern. Keep existing tx-builder and polling logic.

**Pages that gate on `usePrivy().ready`** (`my-souls/page.tsx`, `buy/page.tsx`):
- Switch to `useAuth().loading` / `useAuth().authenticated`, and update `AuthGate`, `useRequireAuth`, desktop link, and account menu together.

### Desktop side — replace Privy custom-auth with local keypair while keeping desktop bearer auth

**Main process** (`desktop/apps/desktop/src/main/auth/`):
- New module `wallet-keystore.ts`: stores the Ed25519 keypair encrypted via Electron `safeStorage`. If `safeStorage.isEncryptionAvailable()` is false, fail closed and show a recoverable auth blocker. Do not write plaintext private keys in production.
- API: `getOrCreateKeypair()`, `getAddress()`, `signPersonalMessage(msg)`, `signTransaction(tx)`.
- IPC handlers (`wallet:address`, `wallet:sign-message`, `wallet:sign-tx`, `wallet:reset`) for renderer.

**Desktop auth boundary**:
- Keep the existing device-code flow and `desktopAccessToken` (`dtk_...`) bearer token for all desktop API calls.
- Browser `/desktop/link` confirms the device with the new session cookie + CSRF header, then desktop polling still receives/stores `desktopAccessToken`.
- Remove the Privy custom-auth add-on after device confirmation: delete `web/app/api/desktop/auth/privy-token/route.ts`, `web/app/api/desktop/auth/jwks/route.ts`, and `web/lib/desktop/privy-custom-auth.ts`; remove `useLinkJwtAccount()` from `web/app/desktop/link/page.tsx`.
- Desktop startup/recovery success is still defined by `desktop-auth:me` / `getDesktopMe` returning a valid server profile. A local keypair or saved token alone is not sufficient.

**Renderer**:
- Drop `<PrivyProvider>` from `ExtractTab.tsx` / `LibraryTab.tsx`.
- New hook `use-desktop-wallet.ts` that talks to main via IPC; same shape as `use-wallet-sign.ts` so renderer code is unified.
- Desktop wallet login/link flow:
  1. Main process signs `/api/auth/wallet-challenge` using the local keypair.
  2. Server verifies the wallet and associates the desktop wallet with the confirmed account/device.
  3. Desktop API calls continue to use `Authorization: Bearer dtk_...`; do not rely on Electron renderer cookies for main-process API calls.

**First-run UX**:
- "Generate new wallet" (default) → Ed25519Keypair created in safeStorage, address shown to user with backup/export warning.
- "Import existing key" → paste suiprivkey1... bech32 / base64 / hex (reuse `scripts/lib/keypair.ts:loadKeypairFromEnv` parser, refactored to take a string instead of env name).
- "Export private key" must exist before any destructive reset UI. Reset must require explicit confirmation and should not clear the server account; it only clears local key material.

### Schema migration

New migration `20260426000000_remove_privy_add_wallet_address`:
```sql
DROP INDEX IF EXISTS accounts_privy_did_key;
ALTER TABLE accounts DROP COLUMN IF EXISTS privy_did;

ALTER TABLE accounts ADD COLUMN wallet_address TEXT;
CREATE UNIQUE INDEX accounts_wallet_address_key ON accounts(wallet_address);
```

Greenfield assumption: no backfill of `wallet_address` from `wallet_bindings`. Before running this migration anywhere beyond local/dev, explicitly confirm the database has no historical Privy-only users or run a destructive reset.

### Env var cleanup

**Drop**:
- `NEXT_PUBLIC_PRIVY_APP_ID`
- `PRIVY_APP_SECRET`
- `PRIVY_CUSTOM_AUTH_ISSUER`
- `PRIVY_CUSTOM_AUTH_PUBLIC_KEY_PEM`
- `PRIVY_CUSTOM_AUTH_PRIVATE_KEY_PEM`

**Already in use, no change**:
- `AUTH_SECRET` — already there for agent claim signing; reused for session JWT.
- `APP_DOMAIN` — challenge-message domain stamp.
- `SOULIDITY_WEB_URL` — Desktop's web base URL.

**Updates**:
- `.env.example`: drop the 5 Privy vars; add a note "AUTH_SECRET also signs human session cookies".

### Package cleanup

**`web/package.json`**:
- Remove `@privy-io/react-auth`, `@privy-io/server-auth`.
- Confirm `@mysten/dapp-kit` is present (it is) and at a version exposing `WalletProvider`, `useCurrentAccount`, `useSignTransaction`, `useSignPersonalMessage`.
- `jose` is already present; use it for session JWT signing/verification.

**`desktop/apps/desktop/package.json`**:
- Remove `@privy-io/react-auth`.
- Add `@mysten/sui` to renderer for keypair types if not transitively available.

**Root `package.json`**: no Privy deps to remove; `@mysten/sui` already added in mainnet prep PRs.

---

## Critical files

**Delete**:
- `web/lib/auth/privy.ts`
- `web/lib/desktop/privy-custom-auth.ts`
- `web/components/providers/privy-provider.tsx`
- `web/lib/hooks/use-privy-sui.ts`
- `web/app/api/desktop/auth/jwks/route.ts`
- `web/app/api/desktop/auth/privy-token/route.ts`
- `desktop/apps/desktop/src/renderer/lib/hooks/use-privy-sui.ts`

**Rewrite**:
- `web/lib/auth/identity.ts` — drop `resolvePrivyIdentity`/`syncSuiWalletBinding`; add `resolveSessionCookie`; new identity priority; no cookie-auth mutating path without CSRF.
- `web/lib/auth/sui-wallet.ts` — keep `getMemberPrimarySuiWalletAddress`, drop any Privy assumptions in comments/docs.
- `web/components/providers/app-providers.tsx` — swap `<PrivyProvider>` for `<WalletProvider>`.
- `web/components/providers/auth-provider.tsx` — backed by `/api/auth/me` + cookie.
- `web/lib/hooks/use-generic-login.ts` → `web/lib/hooks/use-login.ts` — wallet modal + challenge.
- `web/lib/hooks/use-require-auth.ts` — internal calls to `use-login`.
- All `web/lib/hooks/*` and Web pages importing `usePrivySuiSign` — switch to `use-wallet-sign`.
- `web/app/my-souls/page.tsx`, `web/app/souls/[id]/buy/page.tsx`, `web/app/desktop/link/page.tsx` — `useAuth` instead of `usePrivy`.
- `desktop/apps/desktop/src/renderer/components/MainWindow/ExtractTab.tsx`, `LibraryTab.tsx` — drop `<PrivyProvider>`, drop `useCustomAuth`, use IPC hook.
- `desktop/apps/desktop/src/main/index.ts`, `desktop/apps/desktop/src/preload/index.ts`, `desktop/apps/desktop/src/renderer/env.d.ts` — add wallet IPC and remove desktop Privy token IPC.
- `web/app/api/desktop/device/complete/route.ts` and any other mutating route using `requireIdentity()` — pass `Request` into the new CSRF-aware identity helper.

**New**:
- `web/app/api/auth/wallet-challenge/route.ts` — for humans (extract shared helper if agent route can also use it).
- `web/app/api/auth/wallet-login/route.ts` — verify signature, set session cookie.
- `web/app/api/auth/logout/route.ts` — clear session cookie.
- `web/lib/auth/session.ts` — `signSession({memberId, accountId})` + `verifySession(cookie)` using `jose` + `AUTH_SECRET`.
- `web/lib/auth/csrf.ts` — double-submit CSRF token helpers and same-origin validation for cookie-auth mutating requests.
- `web/lib/auth/wallet-login.ts` — shared wallet login/merge transaction for route tests and reuse.
- `web/lib/hooks/use-wallet-sign.ts`, `use-login.ts`.
- `desktop/apps/desktop/src/main/auth/wallet-keystore.ts` — Ed25519Keypair loader/persister via `safeStorage`.
- `desktop/apps/desktop/src/main/auth/ipc.ts` — IPC handlers wiring keystore to renderer.
- `desktop/apps/desktop/src/renderer/lib/hooks/use-desktop-wallet.ts` — IPC client.
- `prisma/migrations/20260426000000_remove_privy_add_wallet_address/migration.sql`.

**Reuse without change**:
- `WalletChallenge` table.
- `verifyPersonalMessageSignature` from `@mysten/sui/verify` (already imported in `identity.ts:637`).
- `WalletBinding` table.
- `Member` / `Account` schema (minus `privyDid`, plus `walletAddress`).
- TG bot runtime — untouched. Web wallet-login handles optional verified TG context if the current Web flow provides one.

---

## Verification

**Unit (vitest)**:
- `tests/web/wallet-login.test.ts` — POST /api/auth/wallet-login with valid signature creates Account+Member+WalletBinding, returns Set-Cookie. Invalid signature → 401. Replayed nonce → 401.
- `tests/web/wallet-login.test.ts` also covers: wallet already bound to another member → 409; verified TG context attaches to existing `tgId` account/member; no verified TG context creates a wallet-owned account.
- `tests/web/session-cookie.test.ts` — `signSession` / `verifySession` round-trip; expired token rejected; tampered token rejected; CSRF token hash mismatch rejected.
- `tests/web/identity-resolve.test.ts` — request with no headers and no cookie → null Identity. With session cookie → human Identity for read path. Mutating helper with session cookie but missing/wrong CSRF → 401/403. Mutating helper with valid CSRF → human Identity. Agent headers/API keys still bypass CSRF.
- `tests/web/desktop-device-routes.test.ts` / `tests/new-web/desktop-device-session.test.ts` — device complete works with new session+CSRF, poll still returns `desktopAccessToken`, and `privy-token` route is gone.
- Focused source tests assert no runtime imports of `@privy-io/*`, `usePrivy`, `useLinkJwtAccount`, `usePrivySuiSign`, `privy-token`, `privyDid`, or `NEXT_PUBLIC_PRIVY_*` remain under `web`, `desktop/apps/desktop`, `prisma`, `src`, and `tests`.

**E2E (Playwright, against testnet)**:
- Web: open app → wallet modal opens → connect Slush testnet wallet → sign challenge → see authenticated UI → logout clears cookie + disconnects wallet.
- Web signing smoke must cover at least purchase plus one creator/admin flow that previously used `usePrivySuiSign` outside purchase.
- Desktop: launch fresh, generate wallet, complete device link, wait for `getDesktopMe` success, verify `desktopAccessToken` is used for desktop API calls, then mint a testnet Soul end-to-end.
- Desktop import: import a known `suiprivkey1...` → verify expected address derived → complete link → mint succeeds.

**Manual / smoke**:
- TG bot: `/start` works. Any TG-origin Web link shows "connect wallet" rather than Privy modal; after wallet connect, the wallet attaches to the existing `tgId` account/member when verified TG context is present.
- Verify `npm test` 1122 → still passes (any Privy-mocked tests must be removed/rewritten).
- `npm run typecheck:root && npm run typecheck:web` clean.
- Vercel preview build for the new branch deploys without `NEXT_PUBLIC_PRIVY_APP_ID`.
- `rg -n "@privy-io|usePrivy|useLinkJwtAccount|usePrivySui|privy-token|privyDid|NEXT_PUBLIC_PRIVY|PRIVY_" web desktop/apps/desktop prisma src tests` returns zero runtime/test hits.

---

## Branching & rollout

- Feature branch `feat/remove-privy-sui-wallet-auth` off `master`.
- Stacked PRs (recommended order):
  1. Schema migration + session/CSRF helpers + new `/api/auth/*` routes + identity helper rewrite. Server tests must pass before UI changes.
  2. Web client switch to dapp-kit `WalletProvider` + new `useAuth` + repo-wide `usePrivySuiSign` replacement.
  3. Desktop main-process wallet keystore + IPC + renderer hook, while preserving `dtk_` bearer token device auth and `getDesktopMe` verification.
  4. Delete Privy routes/deps/env vars + source tests proving no runtime Privy references remain.

**Vercel env cleanup** (after PR merges + first deploy succeeds):
- Remove `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_CUSTOM_AUTH_*` from Production / Preview / Development.

**Risks / sharp edges**:
- Wallet switching mid-session — UI must detect `useCurrentAccount()?.address` change vs. session cookie's stored address; on mismatch, force logout/re-login before any signing or mutation.
- CSRF rollout — every cookie-auth mutating route must use the new helper. Missing one is either a security bug (if it accepts cookie without CSRF) or a product bug (if it still rejects browser sessions).
- Multi-tab — session cookie is shared, but wallet connection state is per-tab. Login in one tab does not auto-connect wallet in others; user reconnects per tab.
- Desktop key loss — if user wipes Electron userData, keypair gone unless exported/imported. Keep account recovery tied to importing the same key or explicitly linking a new wallet through the browser/device flow.
- Desktop auth regression — do not replace `dtk_` bearer APIs with cookie assumptions. Packaged-app verification must prove `getDesktopMe` succeeds from the new bundle.
- AUTH_SECRET rotation — invalidates all sessions; only rotate during deployment with explicit downtime notice.
