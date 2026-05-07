# Wrap Personal Join Batched Walrus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Personal Join / wrap publishing from per-file Walrus uploads to the existing batched Walrus PTB path, so character + memory + optional skills publish with exactly two user wallet signatures.

**Architecture:** Reuse `prepareSoulBlobsForBatchPublish` as the batch register/upload/certify primitive. Add an `attachBeforeMint` hook to the Personal Join SDK builder, then pass `prepared.attachCertifyCalls` into the same PTB as `mint_joined_in_personal_kiosk`. Keep create-soul, collection publish, and `/api/souls/publish` unchanged because they already have the relevant batch/certify plumbing.

**Tech Stack:** Next.js client hooks, Sui PTB builders from `@soulidity/sdk`, existing Walrus batch upload helpers, Vitest source-contract tests.

---

## Current Truth

- `web/lib/upload/client-upload.ts` already exposes the required batch primitive:
  - `prepareBatchWalrusRegisterIntent`
  - `completeBatchWalrusUploadAfterRegister`
  - `prepareSoulBlobsForBatchPublish`
  - `PreparedSoulBlobs.attachCertifyCalls`
  - `PreparedSoulBlobs.clearBatchRecovery`
- `web/app/create/gas/page.tsx` already uses `prepareSoulBlobsForBatchPublish` and passes `prepared.attachCertifyCalls` to `usePublish.attachBeforeMint`; do not rewrite create/gas in this plan.
- `web/lib/hooks/use-publish.ts` and `packages/soulidity-sdk/src/tx/publish.ts` already support `attachBeforeMint`; do not add a duplicate hook there.
- `web/lib/hooks/use-collection-publish.ts` already uses the lower-level batch intent path and splits certify calls by mint chunk; keep it as regression surface only.
- The remaining gap is `web/lib/hooks/use-wrap-publish.ts`: it still calls `uploadSoulPayload` once per character / memory / skills file, then signs a separate `buildPersonalJoinSoulTx` mint transaction.
- Wrap sync must stay on `/api/wrap-link/personal`; it must not be routed through `/api/souls/publish` because Personal Join records source NFT provenance and uses `mint_joined_in_personal_kiosk`.

## File Map

- Modify `packages/soulidity-sdk/src/tx/personal-join.ts`
  - Add `attachBeforeMint?: (tx: Transaction) => void | Promise<void>` to `PersonalJoinTxParams`.
  - Invoke it after the source object is placed/returned and before `mint_joined_in_personal_kiosk`.
- Modify `web/lib/hooks/use-wrap-publish.ts`
  - Replace `uploadSoulPayload` / `uploadFile` with one `prepareSoulBlobsForBatchPublish` call over character, memory, and optional skills.
  - Cache `PreparedSoulBlobs` per wallet + file fingerprint so mint wallet rejection or transient mint failure reuses the same paid register PTB and certificates.
  - Pass `attachBeforeMint: prepared.attachCertifyCalls` into `buildPersonalJoinSoulTx`.
  - Call `prepared.clearBatchRecovery()` only after the Personal Join transaction succeeds.
- Create `tests/new-web/wrap-batched-walrus.test.ts`
  - Static source-contract coverage for the new wrap path, SDK attach hook, and mirror-route boundary.
- No planned changes to `web/app/create/gas/page.tsx`, `web/lib/hooks/use-publish.ts`, `web/lib/hooks/use-collection-publish.ts`, `web/app/api/souls/publish/route.ts`, `web/app/api/wrap-link/personal/route.ts`, `move/soulidity`, or `TODOS.md`.

---

## Task 1: Add Personal Join Certify Attach Hook

**Files:**
- Modify: `packages/soulidity-sdk/src/tx/personal-join.ts`
- Test: `tests/new-web/wrap-batched-walrus.test.ts`

- [ ] **Step 1: Add the failing SDK source-contract test**

Add this case to `tests/new-web/wrap-batched-walrus.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../..')

function readSource(path: string) {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

describe('wrap Personal Join batched Walrus contract', () => {
  it('lets Personal Join attach Walrus certify calls before mint_joined', () => {
    const source = readSource('packages/soulidity-sdk/src/tx/personal-join.ts')

    expect(source).toContain('attachBeforeMint?: (tx: Transaction) => void | Promise<void>')

    const attachIdx = source.indexOf('await params.attachBeforeMint(tx)')
    const mintIdx = source.indexOf('target: `${packageId}::market::mint_joined_in_personal_kiosk`')

    expect(attachIdx).toBeGreaterThanOrEqual(0)
    expect(mintIdx).toBeGreaterThan(attachIdx)
  })
})
```

Run:

```bash
npx vitest run tests/new-web/wrap-batched-walrus.test.ts
```

Expected: FAIL because `PersonalJoinTxParams` does not expose or invoke `attachBeforeMint` yet.

- [ ] **Step 2: Update `PersonalJoinTxParams`**

Add the optional callback:

```ts
export interface PersonalJoinTxParams extends MintPtbInputs {
  currentKioskId?: string | null
  currentKioskCapOnChainId?: string | null
  attachBeforeMint?: (tx: Transaction) => void | Promise<void>
  sourceObjectId: string
  sourceObjectType: string
  name: string
  description: string
  imageUrl: string
  originRef: string
  creatorRoyaltyBps: number
}
```

- [ ] **Step 3: Invoke the callback before mint**

In `buildPersonalJoinSoulTx`, after the `personal_kiosk::return_val` call and before `buildInitialContentArgs`, add:

```ts
  if (params.attachBeforeMint) {
    await params.attachBeforeMint(tx)
  }
```

Because the callback may be async, change the function signature to:

```ts
export async function buildPersonalJoinSoulTx(params: PersonalJoinTxParams): Promise<Transaction> {
```

- [ ] **Step 4: Update the caller type expectation**

`use-wrap-publish.ts` will already `await buildPersonalJoinSoulTx(...)` in Task 2. Do not add this hook to `publish.ts`; the native publish builders already have it.

- [ ] **Step 5: Verify Task 1**

Run:

```bash
npx vitest run tests/new-web/wrap-batched-walrus.test.ts
```

Expected: PASS for the SDK source-contract test. Full typecheck runs after Task 2 because the only live caller is updated there.

---

## Task 2: Switch `useWrapPublish` To Batched Walrus

**Files:**
- Modify: `web/lib/hooks/use-wrap-publish.ts`
- Test: `tests/new-web/wrap-batched-walrus.test.ts`

- [ ] **Step 1: Extend the source-contract test**

Add these cases to `tests/new-web/wrap-batched-walrus.test.ts`:

```ts
  it('uses the batch Walrus helper instead of per-file uploadSoulPayload', () => {
    const source = readSource('web/lib/hooks/use-wrap-publish.ts')

    expect(source).toContain('prepareSoulBlobsForBatchPublish')
    expect(source).toContain('prepared.attachCertifyCalls')
    expect(source).toContain('prepared.clearBatchRecovery()')
    expect(source).not.toContain('uploadSoulPayload')
    expect(source).not.toContain('async function uploadFile')
  })

  it('keeps Personal Join on the wrap mirror route', () => {
    const source = readSource('web/lib/hooks/use-wrap-publish.ts')

    expect(source).toContain("fetch('/api/wrap-link/personal'")
    expect(source).not.toContain("fetch('/api/souls/publish'")
    expect(source).not.toContain('buildPublishSoulTx')
    expect(source).not.toContain('buildPublishSoulWithBindTx')
  })

  it('caches the prepared batch across mint-signature retries', () => {
    const source = readSource('web/lib/hooks/use-wrap-publish.ts')

    expect(source).toContain('preparedBatchRef')
    expect(source).toContain('buildBatchFingerprint')
    expect(source).toContain('cachedBatch.walletAddress === walletAddress')
    expect(source).toContain('cachedBatch.fingerprint === fingerprint')
  })
```

Run:

```bash
npx vitest run tests/new-web/wrap-batched-walrus.test.ts
```

Expected: FAIL because the wrap hook still imports `uploadSoulPayload` and does sequential uploads.

- [ ] **Step 2: Replace upload imports**

In `web/lib/hooks/use-wrap-publish.ts`, replace:

```ts
import { uploadSoulPayload } from '@/lib/upload/client-upload'
```

with:

```ts
import {
  prepareSoulBlobsForBatchPublish,
  type BatchSoulUploadFile,
  type PreparedSoulBlobs,
} from '@/lib/upload/client-upload'
```

Keep `PendingSealMaterial` import unchanged.

- [ ] **Step 3: Remove the per-file helper**

Delete `async function uploadFile(...)`. Keep `withMime(...)`; the batch file list still needs it.

- [ ] **Step 4: Add a stable batch fingerprint helper**

Add this helper near `withMime(...)`:

```ts
function buildBatchFingerprint(walletAddress: string, files: BatchSoulUploadFile[]): string {
  return JSON.stringify({
    walletAddress: walletAddress.toLowerCase(),
    files: files.map((f) => ({
      name: f.file.name,
      size: f.file.size,
      lastModified: f.file.lastModified,
      type: f.file.type,
      uploadType: f.uploadType,
      kind: f.kind,
      sendObjectTo: f.sendObjectTo?.trim().toLowerCase() ?? null,
    })),
  })
}
```

- [ ] **Step 5: Add prepared batch cache**

Inside `useWrapPublish`, add:

```ts
  const preparedBatchRef = useRef<{
    walletAddress: string
    fingerprint: string
    prepared: PreparedSoulBlobs
  } | null>(null)
```

The cache exists only to retry the same draft after mint signature rejection or transient mint failure. It must be cleared after a successful Personal Join mint.

- [ ] **Step 6: Build one batch file list**

Inside the `if (!digest)` block, before uploading, build:

```ts
        const fileIndex = { char: -1, memory: -1, skills: -1 }
        const batchFiles: BatchSoulUploadFile[] = []

        fileIndex.char = batchFiles.length
        batchFiles.push({
          file: withMime(params.charFile),
          uploadType: 'encrypted',
          kind: 'soul-content',
          sendObjectTo: walletAddress,
        })

        fileIndex.memory = batchFiles.length
        batchFiles.push({
          file: withMime(params.memoryFile),
          uploadType: 'encrypted',
          kind: 'soul-content',
          sendObjectTo: walletAddress,
        })

        if (params.skillsFile) {
          fileIndex.skills = batchFiles.length
          batchFiles.push({
            file: withMime(params.skillsFile),
            uploadType: 'encrypted',
            kind: 'soul-content',
            sendObjectTo: walletAddress,
          })
        }
```

- [ ] **Step 7: Move preflight before paid Walrus register**

Before `prepareSoulBlobsForBatchPublish`, resolve kiosk and source object inputs:

```ts
        const personalKiosk = await resolvePersonalKiosk(authHeaders, walletAddress)
        await assertObjectInputsExist(suiClient, {
          'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
          'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
          'Source NFT': params.nft.objectId,
        })
```

This keeps cheap failures ahead of PTB1 so a user does not pay for Walrus register before a missing kiosk/source object failure.

- [ ] **Step 8: Prepare or reuse the batch**

Replace the three `uploadFile(...)` calls with:

```ts
        const fingerprint = buildBatchFingerprint(walletAddress, batchFiles)
        const cachedBatch = preparedBatchRef.current
        const reusable =
          !!cachedBatch
          && cachedBatch.walletAddress === walletAddress
          && cachedBatch.fingerprint === fingerprint

        let prepared: PreparedSoulBlobs
        if (reusable) {
          prepared = cachedBatch.prepared
        } else {
          if (cachedBatch) preparedBatchRef.current = null
          prepared = await prepareSoulBlobsForBatchPublish({
            files: batchFiles,
            walletAddress,
            suiClient,
            signAndExecute,
            authHeaders,
            confirmQuote: requestUploadCostApproval,
          })
          preparedBatchRef.current = { walletAddress, fingerprint, prepared }
        }
```

- [ ] **Step 9: Map prepared files back to content slots**

After prepare/reuse:

```ts
        const charUpload = prepared.files[fileIndex.char]
        const memUpload = prepared.files[fileIndex.memory]
        const skillsUpload = fileIndex.skills >= 0 ? prepared.files[fileIndex.skills] : null
```

Keep the existing blob object and Seal material validations. Add a skills Seal check:

```ts
        if (skillsUpload && !skillsUpload.sealMaterial) {
          throw new Error('Skills file upload is missing Seal recovery data.')
        }
```

- [ ] **Step 10: Attach certifies to the Personal Join mint PTB**

Change the builder call to await the async SDK builder and pass the attach hook:

```ts
        const tx = await buildPersonalJoinSoulTx({
          currentKioskId: personalKiosk?.currentKioskId ?? null,
          currentKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
          sourceObjectId: params.nft.objectId,
          sourceObjectType: params.nft.objectType,
          name: params.nft.name,
          description: params.nft.description || '',
          imageUrl: params.nft.imageUrl || '',
          initialContent: buildLegacyInitialContent({
            protectedBlobObjectId: charUpload.blobObjectId,
            foundingMemoryBlobObjectId: memUpload.blobObjectId,
            skillsBlobObjectId: skillsUpload?.blobObjectId ?? null,
            initialSkillName: skillsUpload?.skillName ?? null,
          }),
          initialStateConfig: buildLegacyInitialStateConfig({
            protectedBlobObjectId: charUpload.blobObjectId,
          }),
          originRef: `sui:${params.nft.objectId}`,
          creatorRoyaltyBps: params.royalty,
          attachBeforeMint: prepared.attachCertifyCalls,
        })
```

- [ ] **Step 11: Clear batch recovery only after successful mint**

After:

```ts
        assertSoulidityTxSucceeded(txResult, 'Soul personal join transaction')
```

add:

```ts
        prepared.clearBatchRecovery()
        preparedBatchRef.current = null
```

Do not clear the prepared batch on wallet rejection or failed effects before this point; retry must reuse the same prepared certificates.

- [ ] **Step 12: Keep wrap sync unchanged**

Leave this route unchanged:

```ts
fetch('/api/wrap-link/personal', ...)
```

The sync body remains `{ txDigest, contentSidecars }` from `buildWrapSyncBody(...)`.

- [ ] **Step 13: Verify Task 2**

Run:

```bash
npx vitest run tests/new-web/wrap-batched-walrus.test.ts
npm run typecheck:root
```

Expected: tests PASS; typecheck PASS.

---

## Task 3: Regression Coverage For Existing Publish Paths

**Files:**
- Test only: existing tests under `tests/new-web/`

- [ ] **Step 1: Run Walrus batch helper regressions**

Run:

```bash
npx vitest run tests/new-web/walrus-batch-helper-split.test.ts tests/new-web/walrus-batch-resume-determinism.test.ts
```

Expected: PASS. This confirms the batch helper still persists recovery before resolving Blob IDs, asserts PTB1 success before completion, and preserves deterministic resume material.

- [ ] **Step 2: Run create/collection mirror regressions**

Run:

```bash
npx vitest run tests/new-web/soulidity-publish-sidecars.test.ts tests/new-web/collection-create-ui.test.ts
```

Expected: PASS. This confirms `contentSidecars[]`, create preflight, and collection batch mirror contracts did not regress.

- [ ] **Step 3: Run wrap route/auth regressions**

Run:

```bash
npx vitest run tests/new-web/auth-gating-ui.test.ts tests/web/repo-contracts.test.ts
```

Expected: PASS. This confirms the wrap route remains present and auth-gated.

- [ ] **Step 4: Run full validation**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS.

---

## Acceptance

- Personal Join with character + memory signs exactly two wallet transactions:
  - PTB1: `N x registerBlob` + `N x transferObjects`
  - PTB2: `N x certifyBlob` + `mint_joined_in_personal_kiosk`
- Personal Join with character + memory + skills still signs exactly two wallet transactions.
- Mint sync still uses `/api/wrap-link/personal` and records the joined/provenance semantics.
- On successful mint, `contentSidecars[]` mirror into `SoulContentVersionRecord` rows for every emitted `ContentVersionAppended` event.
- If the user closes/rejects at the mint signature step after PTB1, retry reuses the cached `PreparedSoulBlobs`; it must not re-encrypt into a different blobId and trigger orphan mismatch.
- Create-soul and collection publish behavior remain unchanged.

## Explicit Non-Goals

- Do not introduce sponsor / platform wallet / TEE wallet.
- Do not add a `deferTransfer` mode in this phase.
- Do not change Walrus aggregation: one Soul content slot remains one Walrus blob.
- Do not change `move/soulidity`.
- Do not reroute Personal Join through `/api/souls/publish`.
- Do not create `useBatchedSoulUpload` in this phase; direct use of `prepareSoulBlobsForBatchPublish` is the smaller and safer closeout because create-soul already has a working local integration.
- Do not edit `TODOS.md` for Phase B unless a future product decision turns sponsor/deferred-transfer into in-scope work. If that happens, the TODO must use the required What / Why / Pros / Cons / Context / Depends on fields.
