import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  WALRUS_SINGLE_BLOB_MAX_BYTES,
  WALRUS_UPLOAD_QUOTE_TTL_MS,
  buildWalrusUploadPlan,
  isWalrusUploadQuoteFresh,
  quoteWalrusUpload,
} from '@/lib/upload/walrus-quote'
import {
  FILE_TOO_LARGE_ERROR,
  MAX_SOUL_UPLOAD_BYTES,
  validateSoulUploadFile,
} from '@/lib/soulidity/upload-validation'

describe('wallet-paid Walrus upload quote guards', () => {
  it('formats WAL costs in human-readable WAL units', async () => {
    const { formatWal } = await import('@/components/upload/upload-cost-review')

    expect(formatWal(0n)).toBe('0 WAL')
    expect(formatWal(436_905n)).toBe('0.000436905 WAL')
    expect(formatWal(300_000_000n)).toBe('0.3 WAL')
    expect(formatWal(1_000_000_000n)).toBe('1 WAL')
  })

  it('quotes all chunks plus the manifest with relay tip before upload', async () => {
    const plan = buildWalrusUploadPlan({
      files: [
        { name: 'large.bin', size: 55 * 1024 * 1024, encryptedSize: 55 * 1024 * 1024 + 16 },
      ],
      network: 'testnet',
      storageEpochs: 3,
      chunking: 'auto',
      relayUrl: 'https://relay.example',
    })

    expect(plan.chunkCount).toBe(4)
    expect(plan.transactionCount).toBe(10)

    // Caller supplies an encoded-size-aware tip calculator (in production this
    // delegates to WalrusClient.calculateUploadRelayTip, which uses
    // encodedBlobLength under the hood).
    const tipCalls: number[] = []
    const quote = await quoteWalrusUpload(plan, {
      now: () => 1_000,
      calculateRelayTip: async (payloadBytes) => {
        tipCalls.push(payloadBytes)
        return BigInt(payloadBytes)
      },
    })

    expect(quote.totalBytes).toBeGreaterThan(55 * 1024 * 1024)
    expect(quote.items).toHaveLength(5)
    expect(tipCalls).toHaveLength(5)
    expect(quote.relayTipMist).toBe(tipCalls.reduce((sum, bytes) => sum + BigInt(bytes), 0n))
    expect(quote.expiresAt).toBe(1_000 + WALRUS_UPLOAD_QUOTE_TTL_MS)
  })

  it('invalidates quotes when TTL, network, relay, file, or chunk plan changes', async () => {
    const plan = buildWalrusUploadPlan({
      files: [{ name: 'soul.md', size: 1024, encryptedSize: 1040 }],
      network: 'testnet',
      storageEpochs: 3,
      chunking: false,
      relayUrl: 'https://relay.example',
    })
    const quote = await quoteWalrusUpload(plan, {
      now: () => 10_000,
      calculateRelayTip: async () => 0n,
    })

    expect(isWalrusUploadQuoteFresh(quote, plan, 10_500)).toBe(true)
    expect(isWalrusUploadQuoteFresh(quote, { ...plan, network: 'mainnet' }, 10_500)).toBe(false)
    expect(isWalrusUploadQuoteFresh(quote, { ...plan, relayUrl: 'https://other.example' }, 10_500)).toBe(false)
    expect(isWalrusUploadQuoteFresh(quote, { ...plan, files: [{ ...plan.files[0]!, payloadBytes: 2048 }] }, 10_500)).toBe(false)
    expect(isWalrusUploadQuoteFresh(quote, plan, quote.expiresAt + 1)).toBe(false)
  })

  it('keeps the browser upload helper off legacy server upload APIs', () => {
    const source = readFileSync('web/lib/upload/client-upload.ts', 'utf8')

    expect(source).toContain('quoteWalrusUpload')
    expect(source).toContain('chunking: false')
    expect(source).not.toContain('/api/souls/upload')
    expect(source).not.toContain('/api/souls/upload/token')
    expect(source).not.toContain('/api/souls/upload/from-blob')
    expect(source).not.toContain('@vercel/blob/client')
    expect(source).not.toContain('sealDekEnvelope')
    expect(source).not.toContain('clawnews-walrus-chunk-manifest')
  })

  it('rejects product uploads above Walrus single-blob size until downloaders can reassemble chunks', () => {
    expect(MAX_SOUL_UPLOAD_BYTES).toBe(WALRUS_SINGLE_BLOB_MAX_BYTES)
    expect(validateSoulUploadFile({
      size: WALRUS_SINGLE_BLOB_MAX_BYTES + 1,
      type: 'application/zip',
    } as File, 'public')).toBe(FILE_TOO_LARGE_ERROR)
  })

  it('does not ask the relay tip quoter to enforce a zero tip ceiling', () => {
    const source = readFileSync('web/lib/upload/client-upload.ts', 'utf8')
    const quoteStart = source.indexOf('const quoteClient = await createWalrusClient')
    const quoteEnd = source.indexOf('const quote = await quoteWalrusUpload', quoteStart)
    const quoteClientBlock = source.slice(quoteStart, quoteEnd)

    expect(quoteStart).toBeGreaterThanOrEqual(0)
    expect(quoteEnd).toBeGreaterThan(quoteStart)
    expect(quoteClientBlock).not.toContain('maxRelayTipMist: 0n')
  })

  it('quotes relay tips via the SDK encoded-size calculator in the legacy single-blob path', () => {
    // The legacy `uploadSoulPayload` still uses the upload relay, so its quote
    // MUST go through WalrusClient.calculateUploadRelayTip to compute tip from
    // encoded blob length (a prior regression used raw payload bytes and
    // produced ~665× under-quotes that crashed mainnet uploads with
    // `Tip amount (...) exceeds the maximum allowed tip (...)`).
    //
    // The batch path (`prepareSoulBlobsForBatchPublish`) deliberately bypasses
    // the relay because the relay only validates `ptb.inputs.first()` as the
    // auth payload, which is incompatible with multi-blob register PTBs.
    const source = readFileSync('web/lib/upload/client-upload.ts', 'utf8')
    const legacyStart = source.indexOf('export async function uploadSoulPayload')
    const quoteStart = source.indexOf('const quote = await quoteWalrusUpload', legacyStart)
    const quoteEnd = source.indexOf('const approved = await params.confirmQuote', quoteStart)
    const quoteBlock = source.slice(quoteStart, quoteEnd)

    expect(legacyStart).toBeGreaterThanOrEqual(0)
    expect(quoteStart).toBeGreaterThan(legacyStart)
    expect(quoteEnd).toBeGreaterThan(quoteStart)
    expect(quoteBlock).toContain('calculateUploadRelayTip')
  })

  it('clears the SDK upload relay tip cache before constructing Walrus clients', () => {
    const source = readFileSync('web/lib/upload/client-upload.ts', 'utf8')

    expect(source).toContain('upload-relay-tip-config')
    expect(source).toContain('cache.clear')
  })

  it('re-resolves missing register-tx blob object ids before resume / mismatch / fresh branching', () => {
    // The batch path persists recovery state with all `blobObjectId: null`
    // immediately after PTB1 signs (so a crash cannot lose the digest), then
    // resolves and re-persists. If the browser, RPC, or `getTransactionBlock()`
    // call fails in that gap, the recovery record sticks around with all-null
    // object ids. Without re-derivation:
    //   - encrypted retries (different blobId due to fresh DEK) hit the
    //     mismatch branch with `orphanBlobObjectId: null` AND drop the only
    //     pointer to the orphan;
    //   - deterministic retries (same blobId) fall through to fresh-register
    //     and silently orphan the prior paid PTB1.
    // The fix re-queries the stored `registerTxDigest` using the *stored*
    // blob ids before deciding what to do.
    const source = readFileSync('web/lib/upload/client-upload.ts', 'utf8')
    const batchStart = source.indexOf('export async function prepareSoulBlobsForBatchPublish')
    const recoveryStart = source.indexOf(
      'matchingRecovery.blobs.every((b) => !!b.blobObjectId)',
      batchStart,
    )
    const resumeStart = source.indexOf('if (matchingRecovery && blobIdsMatch) {', recoveryStart)

    expect(batchStart).toBeGreaterThanOrEqual(0)
    expect(recoveryStart).toBeGreaterThan(batchStart)
    expect(resumeStart).toBeGreaterThan(recoveryStart)

    const recoveryBlock = source.slice(recoveryStart, resumeStart)
    // Resolves against the stored register digest, not a fresh encoding.
    expect(recoveryBlock).toContain('digest: matchingRecovery.registerTxDigest')
    // Uses the stored (prior) blob ids so it works for deterministic AND
    // encrypted retries — for encrypted, the freshly encoded blobIds differ.
    expect(recoveryBlock).toContain('expectedBlobIds: matchingRecovery.blobs.map((b) => b.blobId)')
    // Persists resolved ids back so subsequent retries take the fast path
    // and the mismatch branch can surface a real `orphanBlobObjectId`.
    expect(recoveryBlock).toContain('persistWalrusBatchRecovery(recoveryKey')
    expect(recoveryBlock).toContain("b.blobObjectId = resolvedIds[i]")
  })

  it('does not clear the batch recovery record when re-resolution fails', () => {
    // If `resolveCreatedBlobObjectIds` throws (RPC blip, transient network),
    // the recovery record must remain so the next retry can try again. The
    // re-derivation block is unguarded by try/catch on purpose: any thrown
    // error propagates without touching `clearWalrusBatchRecovery`. The
    // mismatch branch (which IS allowed to clear) must come strictly *after*
    // the re-derivation block so it only fires when object ids are guaranteed
    // non-null.
    const source = readFileSync('web/lib/upload/client-upload.ts', 'utf8')
    const recoveryStart = source.indexOf(
      'matchingRecovery.blobs.every((b) => !!b.blobObjectId)',
    )
    const mismatchClear = source.indexOf(
      'clearWalrusBatchRecovery(recoveryKey)',
      recoveryStart,
    )
    const recoveryEnd = source.indexOf(
      'if (matchingRecovery && blobIdsMatch) {',
      recoveryStart,
    )

    expect(recoveryStart).toBeGreaterThanOrEqual(0)
    expect(recoveryEnd).toBeGreaterThan(recoveryStart)
    // Mismatch's `clearWalrusBatchRecovery` lives after the resume-vs-mismatch
    // dispatch, never inside the re-derivation block.
    expect(mismatchClear).toBeGreaterThan(recoveryEnd)

    const recoveryBlock = source.slice(recoveryStart, recoveryEnd)
    expect(recoveryBlock).not.toContain('clearWalrusBatchRecovery')
    expect(recoveryBlock).not.toContain('try {')
  })

  it('reports the actual wallet-signature count for batch upload plans', async () => {
    // The batch path bundles N register_blob calls into one PTB and N
    // certify_blob calls into the mint PTB, so the user signs exactly two
    // wallet transactions regardless of N. Without an explicit override the
    // generic `(chunkCount + manifestCount) * 2` formula produces a per-blob
    // count (10 for a typical 5-file create flow), which the cost-review
    // modal then displays verbatim. The quote must propagate the override so
    // both the modal and the gas-budget default match reality.
    const plan = buildWalrusUploadPlan({
      files: [
        { name: 'cover.png', size: 1024, encryptedSize: 1024 },
        { name: 'character.md', size: 2048, encryptedSize: 2064 },
        { name: 'memory.txt', size: 512, encryptedSize: 528 },
        { name: 'skills.zip', size: 4096, encryptedSize: 4112 },
        { name: 'sprite.png', size: 8192, encryptedSize: 8192 },
      ],
      network: 'testnet',
      storageEpochs: 12,
      chunking: false,
      relayUrl: 'https://relay.example',
      walletSignatureCount: 2,
    })
    expect(plan.transactionCount).toBe(10)
    expect(plan.walletSignatureCount).toBe(2)

    const quote = await quoteWalrusUpload(plan, {
      now: () => 1_000,
      calculateRelayTip: async () => 0n,
    })
    expect(quote.walletSignatureCount).toBe(2)
    // Gas budget defaults must size against signatures, not per-blob ops.
    expect(quote.gasBudgetMist).toBe(2n * 50_000_000n)

    // Freshness check considers walletSignatureCount so a stale legacy quote
    // (without the override) cannot satisfy a batch plan that requires it.
    const legacyPlan = buildWalrusUploadPlan({
      files: plan.files.map((f) => ({ name: f.name, size: f.plaintextBytes, encryptedSize: f.payloadBytes })),
      network: 'testnet',
      storageEpochs: 12,
      chunking: false,
      relayUrl: 'https://relay.example',
    })
    expect(legacyPlan.walletSignatureCount).toBeNull()
    const legacyQuote = await quoteWalrusUpload(legacyPlan, {
      now: () => 1_000,
      calculateRelayTip: async () => 0n,
    })
    expect(isWalrusUploadQuoteFresh(legacyQuote, plan, 1_500)).toBe(false)
    expect(isWalrusUploadQuoteFresh(quote, legacyPlan, 1_500)).toBe(false)
  })

  it('runs kiosk + publish-arg + env preflight before the paid batch register PTB', () => {
    // R-002: the legacy create flow ran `prepareSoulBlobsForBatchPublish` (paid
    // PTB1) BEFORE `publish()`'s personal-kiosk fetch, on-chain object check,
    // and `buildPublishSoulTx` env validation. Any 5xx, RPC blip, or missing
    // env between PTB1 and PTB2 then orphaned the just-paid Blob objects: the
    // next Deploy click re-encrypted the batch with fresh DEKs, the resulting
    // blobIds did not match the persisted recovery, and the mismatch branch
    // surfaced an orphan instead of letting the user finish the same mint.
    // The fix moves all wallet-free preflight ahead of `prepareSoul...` and
    // hands the resolved kiosk down to `publish()` so the hook does not
    // re-fetch.
    const source = readFileSync('web/app/create/gas/page.tsx', 'utf8')
    const handleStart = source.indexOf('async function handleDeploy()')
    const preflightStart = source.indexOf("setUploadPhase('preflight')", handleStart)
    const prepareCall = source.indexOf('prepareSoulBlobsForBatchPublish(', preflightStart)
    const publishCall = source.indexOf('await publish(', prepareCall)
    expect(handleStart).toBeGreaterThanOrEqual(0)
    expect(preflightStart).toBeGreaterThan(handleStart)
    expect(prepareCall).toBeGreaterThan(preflightStart)
    expect(publishCall).toBeGreaterThan(prepareCall)

    const preflightBlock = source.slice(preflightStart, prepareCall)
    expect(preflightBlock).toContain('/api/souls/personal-kiosk?walletAddress=')
    expect(preflightBlock).toContain('assertObjectInputsExist(suiClient')
    expect(preflightBlock).toContain('validateSoulPublishArgs')
    expect(preflightBlock).toContain('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
    expect(preflightBlock).toContain('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')

    // Caller threads the prefetched kiosk into publish() so the hook does not
    // re-resolve and a transient 5xx after PTB1 cannot orphan the register.
    const publishBlock = source.slice(publishCall, source.indexOf('})', publishCall))
    expect(publishBlock).toContain('prefetchedPersonalKiosk')

    // The publish hook honours the prefetched kiosk before calling its own
    // resolvePersonalKiosk fallback. Critically, it must distinguish between
    // `undefined` (caller did not preflight) and `null` (caller preflighted
    // and confirmed no kiosk yet — first-time creator). A naive `??` falls
    // back to a fresh fetch on null, which a transient 5xx after PTB1 then
    // orphans into the very batch-mismatch path the preflight was meant to
    // close.
    const hookSource = readFileSync('web/lib/hooks/use-publish.ts', 'utf8')
    expect(hookSource).toContain("Object.prototype.hasOwnProperty.call(params, 'prefetchedPersonalKiosk')")
    expect(hookSource).toMatch(/\?\s*params\.prefetchedPersonalKiosk\s*\n\s*:\s*await resolvePersonalKiosk\(/)
    expect(hookSource).not.toMatch(/params\.prefetchedPersonalKiosk\s*\n\s*\?\?\s*\(?await resolvePersonalKiosk/)
  })

  it('routes the batch wrapper through walletSignatureCount: 2', () => {
    // The batch path bundles register and certify into two PTBs total. The
    // cost-review modal reads `walletSignatureCount` from the quote and shows
    // "Wallet signatures" instead of the per-blob "Transactions" label.
    const source = readFileSync('web/lib/upload/client-upload.ts', 'utf8')
    const wrapperStart = source.indexOf('function buildAggregateUploadPlan')
    const wrapperEnd = source.indexOf('\n}\n', wrapperStart)
    expect(wrapperStart).toBeGreaterThanOrEqual(0)
    expect(wrapperEnd).toBeGreaterThan(wrapperStart)
    expect(source.slice(wrapperStart, wrapperEnd)).toContain('walletSignatureCount: 2')

    const modal = readFileSync('web/components/upload/upload-cost-review.tsx', 'utf8')
    expect(modal).toContain('Wallet signatures')
    expect(modal).toContain('quote.walletSignatureCount')
  })

  it('preserves every orphan blob descriptor on the batch resume-mismatch error', () => {
    // Pre-fix: the mismatch branch threw with `orphanBlobObjectId: <first
    // non-null>` and `orphanBlobId: <first blobId>` (singular), then
    // immediately cleared the batch recovery record. A typical create batch
    // (cover + character + memory + skills + sprite) registered five Blob
    // objects in PTB1; after clearing the recovery, the error carried only
    // ONE object id, so the deletable-blob cleanup flow had no pointer to the
    // remaining four. The fix swaps the singular pointers for an
    // `orphanBlobs` array snapshotted from `matchingRecovery.blobs` BEFORE
    // the clear, and preserves the snapshot capture happens before clearing.
    const source = readFileSync('web/lib/upload/client-upload.ts', 'utf8')
    const dispatchStart = source.indexOf('} else if (matchingRecovery && !blobIdsMatch) {')
    const dispatchEnd = source.indexOf('} else {', dispatchStart)
    expect(dispatchStart).toBeGreaterThanOrEqual(0)
    expect(dispatchEnd).toBeGreaterThan(dispatchStart)
    const block = source.slice(dispatchStart, dispatchEnd)

    // Snapshots every blob descriptor (no `find` shortcut, no `[0]` shortcut).
    expect(block).toContain('matchingRecovery.blobs.map')
    expect(block).toContain('blobObjectId: b.blobObjectId')
    expect(block).not.toMatch(/matchingRecovery\.blobs\.find\(/)
    expect(block).not.toMatch(/matchingRecovery\.blobs\[0\]\?\.blobId/)

    // The snapshot lives strictly before the clear, so the thrown error
    // captures every blobObjectId / blobId, not just the first.
    const snapshotIdx = block.indexOf('matchingRecovery.blobs.map')
    const clearIdx = block.indexOf('clearWalrusBatchRecovery(recoveryKey)')
    expect(snapshotIdx).toBeGreaterThanOrEqual(0)
    expect(clearIdx).toBeGreaterThan(snapshotIdx)

    // Error carries the array, not singular pointers.
    expect(block).toContain('orphanBlobs')
    expect(block).not.toMatch(/orphanBlobObjectId:/)
    expect(block).not.toMatch(/orphanBlobId:/)

    // Class shape matches: `orphanBlobs` is canonical, no legacy singular
    // pointers, and `orphanTxDigest` survives.
    const recovery = readFileSync('web/lib/upload/walrus-recovery.ts', 'utf8')
    const classStart = recovery.indexOf('export class WalrusUploadResumeMismatchError')
    const classEnd = recovery.indexOf('\n}\n', classStart)
    expect(classStart).toBeGreaterThanOrEqual(0)
    expect(classEnd).toBeGreaterThan(classStart)
    const classBlock = recovery.slice(classStart, classEnd)
    expect(classBlock).toContain('readonly orphanBlobs: ReadonlyArray<WalrusOrphanBlob>')
    expect(classBlock).toContain('readonly orphanTxDigest: string')
    expect(classBlock).not.toMatch(/readonly orphanBlobObjectId:/)
    expect(classBlock).not.toMatch(/readonly orphanBlobId:/)
  })

  it('rejects mint PTB digests whose effects.status is not "success" before clearing batch recovery', () => {
    // Pre-fix: usePublish() called `setTxDigest` and `params.onMintTxExecuted`
    // immediately after `signAndExecute(tx)` returned, regardless of
    // `effects.status.status`. Because the wallet helper returns the raw
    // executeTransactionBlock result without rejecting Move aborts, a digest
    // with `effects.status.status === 'failure'` (stale kiosk caps, bad
    // Walrus cert, any other on-chain abort) still cleared batch recovery —
    // and `extractSoulMintedToKioskEvent` then threw on the missing event,
    // leaving the user stuck with the registered PTB1 Blob objects orphaned
    // forever. The fix verifies the success status before persisting the
    // digest or invoking the recovery-clearing callback, and throws on
    // failure so the existing batch recovery record stays available for
    // retry.
    const source = readFileSync('web/lib/hooks/use-publish.ts', 'utf8')
    const signStart = source.indexOf('const result = await signAndExecute(tx)')
    const onMintIdx = source.indexOf('params.onMintTxExecuted?.()', signStart)
    const setDigestIdx = source.indexOf('setTxDigest(executedDigest)', signStart)
    expect(signStart).toBeGreaterThanOrEqual(0)
    expect(setDigestIdx).toBeGreaterThan(signStart)
    expect(onMintIdx).toBeGreaterThan(setDigestIdx)

    const guardBlock = source.slice(signStart, setDigestIdx)
    // Uses the shared Sui result assertion instead of hand-reading
    // effects.status.status at each call site.
    expect(guardBlock).toContain("assertSuiTxSucceeded(result, 'Soul mint transaction')")
    // Throws on non-success BEFORE setTxDigest / onMintTxExecuted runs, so a
    // failed digest cannot clear batch recovery.
    expect(guardBlock).not.toContain('setTxDigest')
    expect(guardBlock).not.toContain('onMintTxExecuted')
  })

  it('rejects failed import and wrap mint digests before persisting recovery', () => {
    // signAndExecute returns the raw wallet execution result. These flows must
    // reject failed Move effects before writing txDigest/recovery state, or a
    // failed digest is replayed forever on retry.
    const importSource = readFileSync('web/lib/hooks/use-import.ts', 'utf8')
    const importSignStart = importSource.indexOf('const result = await signAndExecute(tx)')
    const importSetDigest = importSource.indexOf('setTxDigest(executedDigest)', importSignStart)
    const importPersist = importSource.indexOf('persistImportRecovery(recovery)', importSignStart)
    expect(importSignStart).toBeGreaterThanOrEqual(0)
    expect(importSetDigest).toBeGreaterThan(importSignStart)
    expect(importPersist).toBeGreaterThan(importSetDigest)

    const importGuardBlock = importSource.slice(importSignStart, importSetDigest)
    expect(importGuardBlock).toContain("assertSuiTxSucceeded(result, 'Soul import transaction')")
    expect(importGuardBlock).not.toContain('setTxDigest')
    expect(importGuardBlock).not.toContain('persistImportRecovery')

    const wrapSource = readFileSync('web/lib/hooks/use-wrap-publish.ts', 'utf8')
    const wrapSignStart = wrapSource.indexOf('const txResult = await signAndExecute(tx)')
    const wrapSetDigest = wrapSource.indexOf('setTxDigest(executedDigest)', wrapSignStart)
    const wrapPersist = wrapSource.indexOf('persistWrapRecovery(recovery)', wrapSignStart)
    expect(wrapSignStart).toBeGreaterThanOrEqual(0)
    expect(wrapSetDigest).toBeGreaterThan(wrapSignStart)
    expect(wrapPersist).toBeGreaterThan(wrapSetDigest)

    const wrapGuardBlock = wrapSource.slice(wrapSignStart, wrapSetDigest)
    expect(wrapGuardBlock).toContain("assertSuiTxSucceeded(txResult, 'Soul personal join transaction')")
    expect(wrapGuardBlock).not.toContain('setTxDigest')
    expect(wrapGuardBlock).not.toContain('persistWrapRecovery')
  })

  it('rejects failed collection transaction digests before persisting collection recovery', () => {
    const source = readFileSync('web/lib/hooks/use-collection-publish.ts', 'utf8')

    const createSignStart = source.indexOf('const result = await signAndExecute(tx)')
    const createSetDigest = source.indexOf('setTxDigest(digest)', createSignStart)
    expect(createSignStart).toBeGreaterThanOrEqual(0)
    expect(createSetDigest).toBeGreaterThan(createSignStart)
    const createGuardBlock = source.slice(createSignStart, createSetDigest)
    expect(createGuardBlock).toContain("assertSuiTxSucceeded(result, 'Collection create transaction')")
    expect(createGuardBlock).not.toContain('setTxDigest')
    expect(createGuardBlock).not.toContain('recovery.txDigest')

    const mintSignStart = source.indexOf('const mintResult = await signAndExecute(mintTx)')
    const mintPersist = source.indexOf('soulState.mintDigest = mintDigest', mintSignStart)
    expect(mintSignStart).toBeGreaterThan(createSetDigest)
    expect(mintPersist).toBeGreaterThan(mintSignStart)
    const mintGuardBlock = source.slice(mintSignStart, mintPersist)
    expect(mintGuardBlock).toContain("assertSuiTxSucceeded(mintResult, 'Collection soul mint transaction')")
    expect(mintGuardBlock).not.toContain('soulState.mintDigest')

    const bindSignStart = source.indexOf('const addResult = await signAndExecute(addTx)')
    const bindPersist = source.indexOf('soulState.bindDigest = bindDigest', bindSignStart)
    expect(bindSignStart).toBeGreaterThan(mintPersist)
    expect(bindPersist).toBeGreaterThan(bindSignStart)
    const bindGuardBlock = source.slice(bindSignStart, bindPersist)
    expect(bindGuardBlock).toContain("assertSuiTxSucceeded(addResult, 'Collection bind transaction')")
    expect(bindGuardBlock).not.toContain('soulState.bindDigest')
  })

  it('persists mint recovery before invoking onMintTxExecuted (clears batch recovery)', () => {
    // Pre-fix: usePublish() called `params.onMintTxExecuted?.()` (which clears
    // the persisted batch register-recovery row in the create flow) BEFORE it
    // wrote `MintRecoveryState` to sessionStorage. A tab crash, refresh, or
    // OS kill in the window between the wallet returning a successful mint
    // digest and `persistMintRecovery(recovery)` executing left the user
    // with a minted Soul on-chain but no resumable mirror state on either
    // side: the batch recovery row was already deleted, the
    // `soul-mint-recovery` sessionStorage entry had not been written, and
    // `preparedBatchRef` was lost with the tab. The fix flips the order so
    // mint recovery is durable before batch recovery is cleared.
    const source = readFileSync('web/lib/hooks/use-publish.ts', 'utf8')
    const signStart = source.indexOf('const result = await signAndExecute(tx)')
    const persistMintIdx = source.indexOf('persistMintRecovery(recovery)', signStart)
    const onMintIdx = source.indexOf('params.onMintTxExecuted?.()', signStart)
    expect(signStart).toBeGreaterThanOrEqual(0)
    expect(persistMintIdx).toBeGreaterThan(signStart)
    expect(onMintIdx).toBeGreaterThan(persistMintIdx)
  })

  it('rejects a failed batch register PTB before persisting batch recovery', () => {
    // Pre-fix: prepareSoulBlobsForBatchPublish read registerResult.digest and
    // immediately persisted a batch recovery row before checking
    // effects.status. The wallet helper (useWalletSign) returns the raw
    // executeTransactionBlock result and does NOT reject on Move aborts, so a
    // submitted register PTB with effects.status.status === 'failure' still
    // wrote a recovery row pointing at a digest that created no Blob objects.
    // The next Deploy click then loaded that record and the re-derivation
    // block tried to resolve Blob objects from a failed digest before the
    // fresh-register branch could run, wedging the draft until the user
    // manually cleared session storage. The fix verifies effects.status
    // BEFORE assigning the digest or persisting recovery, clears any stale
    // record under the same key, and throws a descriptive error.
    const source = readFileSync('web/lib/upload/client-upload.ts', 'utf8')
    const batchStart = source.indexOf('export async function prepareSoulBlobsForBatchPublish')
    const signCall = source.indexOf('await params.signAndExecute(tx)', batchStart)
    const persistCall = source.indexOf('persistWalrusBatchRecovery(recoveryKey, {\n      walletAddress: params.walletAddress', signCall)
    expect(batchStart).toBeGreaterThanOrEqual(0)
    expect(signCall).toBeGreaterThan(batchStart)
    expect(persistCall).toBeGreaterThan(signCall)

    const guardBlock = source.slice(signCall, persistCall)
    // Uses the shared Sui result assertion instead of duplicating
    // effects.status parsing at each Walrus call site.
    expect(guardBlock).toContain("assertSuiTxSucceeded(registerResult, 'Walrus batch register transaction')")
    // Clears any stale recovery row so a retry can register from a clean state.
    expect(guardBlock).toContain('clearWalrusBatchRecovery(recoveryKey)')
    // Throws BEFORE persistWalrusBatchRecovery runs and BEFORE the digest
    // is assigned to registerDigest (which is consumed by the persist call).
    expect(guardBlock).not.toContain('persistWalrusBatchRecovery')
  })

  it('rejects a failed single-blob register PTB before persisting upload recovery', () => {
    // Same fix in the legacy single-blob path. uploadSingleBlob persisted a
    // WalrusUploadRecoveryRecord off the register digest without checking
    // effects.status; a failed register would then make the next attempt's
    // writeBlobFlow.encode({ resume }) throw with a stale-orphan error even
    // though no Blob exists on chain.
    const source = readFileSync('web/lib/upload/client-upload.ts', 'utf8')
    const fnStart = source.indexOf('async function uploadSingleBlob')
    const signCall = source.indexOf('await params.signAndExecute(registerTx)', fnStart)
    const persistCall = source.indexOf('persistWalrusUploadRecovery(params.recoveryKey, {', signCall)
    expect(fnStart).toBeGreaterThanOrEqual(0)
    expect(signCall).toBeGreaterThan(fnStart)
    expect(persistCall).toBeGreaterThan(signCall)

    const guardBlock = source.slice(signCall, persistCall)
    expect(guardBlock).toContain("assertSuiTxSucceeded(registerResult, 'Walrus register transaction')")
    expect(guardBlock).toContain('clearWalrusUploadRecovery(params.recoveryKey)')
    expect(guardBlock).not.toContain('persistWalrusUploadRecovery')
  })

  it('rejects a failed single-blob certify PTB before clearing upload recovery', () => {
    // Pre-fix: uploadSingleBlob's certify step trusted any returned digest as
    // success. signAndExecute (via useWalletSign) returns the raw
    // executeTransactionBlock response with showEffects: true and does NOT
    // reject Move aborts, so a certify digest with effects.status.status ===
    // 'failure' (stale/deleted Blob, gas failure during certify) still ran
    // flow.getBlob() and immediately cleared the upload recovery record.
    // A retry then had no resume row to skip the paid register PTB and would
    // burn another wallet payment to register a fresh Blob. The fix mirrors
    // the register guard: read effects.status before flow.getBlob() and
    // before clearWalrusUploadRecovery, throw a descriptive error on
    // non-success, leaving the recovery record intact for the next attempt
    // to resume at certify.
    const source = readFileSync('web/lib/upload/client-upload.ts', 'utf8')
    const fnStart = source.indexOf('async function uploadSingleBlob')
    const certifySignCall = source.indexOf('const certifyResult = await params.signAndExecute(certifyTx)', fnStart)
    const getBlobCall = source.indexOf('await flow.getBlob()', certifySignCall)
    const clearCall = source.indexOf('clearWalrusUploadRecovery(params.recoveryKey)', certifySignCall)
    expect(fnStart).toBeGreaterThanOrEqual(0)
    expect(certifySignCall).toBeGreaterThan(fnStart)
    expect(getBlobCall).toBeGreaterThan(certifySignCall)
    expect(clearCall).toBeGreaterThan(getBlobCall)

    const guardBlock = source.slice(certifySignCall, getBlobCall)
    // Uses the shared Sui result assertion instead of duplicating
    // effects.status parsing at each Walrus call site.
    expect(guardBlock).toContain("assertSuiTxSucceeded(certifyResult, 'Walrus certify transaction')")
    // Throws BEFORE flow.getBlob() and BEFORE clearWalrusUploadRecovery, so a
    // failed certify cannot strand the caller with a cleared recovery.
    // No actual call expressions for getBlob or clearWalrusUploadRecovery
    // appear before the throw (comments referencing them are fine).
    expect(guardBlock).not.toMatch(/await\s+flow\.getBlob\s*\(/)
    expect(guardBlock).not.toMatch(/clearWalrusUploadRecovery\s*\(\s*params\.recoveryKey\s*\)/)
  })

  it('caches the prepared batch across mint-signature retries until mint succeeds', () => {
    // Pre-fix: every Deploy click called prepareSoulBlobsForBatchPublish()
    // from scratch. preparePayload() generates fresh AES-GCM keys on every
    // call, so the freshly-encoded blobIds did not match the persisted PTB1
    // recovery and the mismatch branch surfaced an orphan error instead of
    // letting the user retry the same paid PTB1 — a normal mint-signature
    // rejection or transient SDK/RPC error after PTB1 succeeded would force
    // the user to reclaim orphans and start over. The fix caches the prepared
    // batch in a useRef keyed by wallet address + a stable file fingerprint,
    // reuses it on retry, and clears it via the wrapped onMintTxExecuted only
    // after the mint TX has actually executed successfully.
    const source = readFileSync('web/app/create/gas/page.tsx', 'utf8')

    // Cache lives in a useRef holding wallet address, fingerprint, and the
    // prepared batch.
    expect(source).toMatch(/preparedBatchRef\s*=\s*useRef/)
    expect(source).toContain('walletAddress: string')
    expect(source).toContain('fingerprint: string')
    expect(source).toContain('prepared: PreparedSoulBlobs')

    // Cache fingerprint is derived from a stable subset of file metadata
    // (name, size, lastModified, type) plus the batch shape so a real file
    // change yields a fresh prepare.
    expect(source).toContain('function buildBatchFingerprint')
    const fpStart = source.indexOf('function buildBatchFingerprint')
    const fpEnd = source.indexOf('\n}\n', fpStart)
    expect(fpEnd).toBeGreaterThan(fpStart)
    const fpBlock = source.slice(fpStart, fpEnd)
    expect(fpBlock).toContain('lastModified')
    expect(fpBlock).toContain('uploadType')
    expect(fpBlock).toContain('sendObjectTo')

    // Cache is consulted before calling prepareSoulBlobsForBatchPublish, and
    // the call only runs when the cache is not reusable.
    const handleStart = source.indexOf('async function handleDeploy()')
    const prepareCall = source.indexOf('prepareSoulBlobsForBatchPublish(', handleStart)
    expect(handleStart).toBeGreaterThanOrEqual(0)
    expect(prepareCall).toBeGreaterThan(handleStart)
    const beforePrepare = source.slice(handleStart, prepareCall)
    expect(beforePrepare).toContain('preparedBatchRef.current')
    expect(beforePrepare).toMatch(/cachedBatch\.fingerprint\s*===\s*fingerprint/)

    // The mint-success callback both calls the SDK clear AND clears our cache
    // so the next deploy starts from a fresh prepare with new DEKs.
    const onMintExecutedIdx = source.indexOf('onMintTxExecuted:', prepareCall)
    expect(onMintExecutedIdx).toBeGreaterThan(prepareCall)
    const onMintExecutedBlock = source.slice(onMintExecutedIdx, onMintExecutedIdx + 200)
    expect(onMintExecutedBlock).toContain('prepared.clearBatchRecovery')
    expect(onMintExecutedBlock).toContain('preparedBatchRef.current = null')
  })

  it('uses live assets-root state before paid post-mint sprite upload and retries stale root creation with the uploaded blob', () => {
    // Post-mint sprite uploads are wallet-paid before the SoulAssets PTB signs.
    // The append hook must not choose the first-root creation branch from stale
    // mirrored DB state after paying Walrus storage. It should refresh the live
    // SoulState root first, and if a concurrent tab creates the root between
    // that refresh and this PTB, retry the existing-root append with the
    // already-uploaded Blob object instead of abandoning it.
    const source = readFileSync('web/lib/hooks/use-assets.ts', 'utf8')
    const appendStart = source.indexOf('async function appendAndActivateSprite')
    const liveRead = source.indexOf('resolveLiveSoulAssetsOnChainId(', appendStart)
    const uploadCall = source.indexOf('const uploaded = await uploadAssetFile', appendStart)
    expect(appendStart).toBeGreaterThanOrEqual(0)
    expect(liveRead).toBeGreaterThan(appendStart)
    expect(uploadCall).toBeGreaterThan(liveRead)

    const appendBlock = source.slice(appendStart, source.indexOf('\n  async function deleteVersion', appendStart))
    expect(appendBlock).toContain('const initialAssetsOnChainId = await resolveLiveSoulAssetsOnChainId')
    expect(appendBlock).toContain('buildSpriteAppendTransaction({')
    expect(appendBlock).toContain('assetsOnChainId: initialAssetsOnChainId')
    expect(appendBlock).toContain('isAssetsRootAlreadyExistsError(txError)')
    expect(appendBlock).toContain('const retryAssetsOnChainId = await resolveLiveSoulAssetsOnChainId')
    expect(appendBlock).toContain('assetsOnChainId: retryAssetsOnChainId')
    expect(appendBlock).toContain('blobObjectId: uploaded.blobObjectId')
  })

  it('maps duplicate expected blobIds to distinct created Blob objects via a per-blobId queue', () => {
    // `resolveCreatedBlobObjectIds` previously stored `Map<string, string>`,
    // which meant a single batch containing the same public payload twice (e.g.
    // user reuses the same PNG as cover image and as a persona sprite) would
    // collapse both expected slots onto whichever decoded Blob was iterated
    // last, leaving one created Blob ignored and certifying the other twice.
    // The fix uses `Map<string, string[]>` and consumes one objectId per slot,
    // so duplicate expected blobIds correctly map to distinct Blob objects.
    const source = readFileSync('web/lib/upload/client-upload.ts', 'utf8')
    const fnStart = source.indexOf('async function resolveCreatedBlobObjectIds')
    const fnEnd = source.indexOf('\n}\n', fnStart)
    expect(fnStart).toBeGreaterThanOrEqual(0)
    expect(fnEnd).toBeGreaterThan(fnStart)

    const fnSource = source.slice(fnStart, fnEnd)
    expect(fnSource).toContain('Map<string, string[]>')
    expect(fnSource).not.toMatch(/new Map<string,\s*string>\(\)/)
    // Each expected slot consumes exactly one queue entry rather than
    // re-reading the latest set value.
    expect(fnSource).toMatch(/queue\?\.shift\(\)/)
  })

  it('falls back to storage confirmations after a direct node write failure', () => {
    // A real create attempt can fail with
    // "Too many failures while writing blob ... to nodes" even after enough
    // storage nodes have persisted the slivers. The Blob object is already
    // paid/registered at that point, so the batch path should re-query
    // confirmations and continue to certificate+mint when quorum is available.
    const source = readFileSync('web/lib/upload/client-upload.ts', 'utf8')
    const helperStart = source.indexOf('async function writeEncodedBlobAndBuildCertificate')
    const helperEnd = source.indexOf('\n}\n', helperStart)

    expect(helperStart).toBeGreaterThanOrEqual(0)
    expect(helperEnd).toBeGreaterThan(helperStart)
    const helperBlock = source.slice(helperStart, helperEnd)
    expect(helperBlock).toContain('client.writeEncodedBlobToNodes')
    expect(helperBlock).toContain('client.getStorageConfirmations')
    expect(helperBlock).toContain('client.certificateFromConfirmations')

    const batchStart = source.indexOf('export async function prepareSoulBlobsForBatchPublish')
    const uploadStart = source.indexOf('const uploaded = await Promise.all', batchStart)
    const uploadEnd = source.indexOf('// 8. Materialize per-file results', uploadStart)
    expect(batchStart).toBeGreaterThanOrEqual(0)
    expect(uploadStart).toBeGreaterThan(batchStart)
    expect(uploadEnd).toBeGreaterThan(uploadStart)
    const uploadBlock = source.slice(uploadStart, uploadEnd)
    expect(uploadBlock).toContain('writeEncodedBlobAndBuildCertificate')
    expect(uploadBlock).not.toContain('client.writeEncodedBlobToNodes({')
  })

  it('exposes a wallet-signed reclaim helper for stale batch orphans', () => {
    // A batch resume mismatch means the prior register PTB has already created
    // deletable Blob objects, but the current encrypted payloads no longer
    // match those blobIds. The app needs a first-class helper that builds a
    // wallet-signed Walrus delete transaction for every orphan object instead
    // of leaving users with only a textual "use deletable-blob flow" hint.
    const source = readFileSync('web/lib/upload/client-upload.ts', 'utf8')
    const helperStart = source.indexOf('export async function reclaimWalrusOrphanBlobs')
    const helperEnd = source.indexOf('\n}\n', helperStart)

    expect(helperStart).toBeGreaterThanOrEqual(0)
    expect(helperEnd).toBeGreaterThan(helperStart)
    const helperBlock = source.slice(helperStart, helperEnd)
    expect(helperBlock).toContain('createWalrusClient')
    expect(helperBlock).toContain('client.deleteBlob')
    expect(helperBlock).toContain('tx.transferObjects')
    expect(helperBlock).toContain('params.signAndExecute(tx)')
    expect(helperBlock).toContain("assertSuiTxSucceeded(result, 'Walrus orphan reclaim transaction')")
  })

  it('surfaces batch resume mismatch with a reclaim action on the create gas page', () => {
    // The stale encrypted-payload case is expected after a page refresh or
    // after a previous deploy failed before `preparedBatchRef` was populated.
    // The create page should keep the orphan descriptors from the thrown
    // WalrusUploadResumeMismatchError and expose a wallet action to reclaim
    // them, while still allowing the next deploy attempt to start clean after
    // the recovery row has been cleared.
    const source = readFileSync('web/app/create/gas/page.tsx', 'utf8')

    expect(source).toContain('WalrusUploadResumeMismatchError')
    expect(source).toContain('reclaimWalrusOrphanBlobs')
    expect(source).toContain('const [walrusOrphanRecovery, setWalrusOrphanRecovery]')
    expect(source).toContain('async function handleReclaimWalrusOrphans')
    expect(source).toContain('setWalrusOrphanRecovery({')

    const handleDeployStart = source.indexOf('async function handleDeploy()')
    const catchStart = source.indexOf('} catch (err) {', handleDeployStart)
    const catchEnd = source.indexOf('setUploadPhase(\'idle\')', catchStart)
    expect(catchStart).toBeGreaterThanOrEqual(0)
    expect(catchEnd).toBeGreaterThan(catchStart)
    const catchBlock = source.slice(catchStart, catchEnd)
    expect(catchBlock).toContain('err instanceof WalrusUploadResumeMismatchError')
    expect(catchBlock).toContain('preparedBatchRef.current = null')
    expect(catchBlock).toContain('setWalrusOrphanRecovery')

    const reclaimStart = source.indexOf('async function handleReclaimWalrusOrphans')
    const reclaimEnd = source.indexOf('\n  }\n', reclaimStart)
    expect(reclaimStart).toBeGreaterThanOrEqual(0)
    expect(reclaimEnd).toBeGreaterThan(reclaimStart)
    const reclaimBlock = source.slice(reclaimStart, reclaimEnd)
    expect(reclaimBlock).toContain('reclaimWalrusOrphanBlobs')
    expect(reclaimBlock).toContain('showToast')
    expect(reclaimBlock).toContain('setWalrusOrphanRecovery(null)')
  })
})
