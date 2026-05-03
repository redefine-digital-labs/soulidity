import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

const HOOK = 'web/lib/hooks/use-collection-publish.ts'
const PUBLISH_HOOK = 'web/lib/hooks/use-publish.ts'
const BATCH_ROUTE = 'web/app/api/souls/publish/batch/route.ts'
const SOUL_LIST_ROUTE = 'web/app/api/souls/[id]/list/route.ts'
const COLLECTION_LIST_ROUTE = 'web/app/api/collections/[id]/list/route.ts'
const EVENTS = 'web/lib/soulidity/events.ts'
const SMOKE = 'scripts/smoke-soulidity.ts'

describe('collection 2-signature fast path regressions', () => {
  it('PTB1 builds register + create_collection + finalize_collection in the same Transaction', () => {
    const src = readSource(HOOK)
    const ptb1Start = src.indexOf('// ── Phase 2: PTB1')
    const ptb1End = src.indexOf('// ── Phase 3:', ptb1Start)
    expect(ptb1Start).toBeGreaterThanOrEqual(0)
    expect(ptb1End).toBeGreaterThan(ptb1Start)
    const block = src.slice(ptb1Start, ptb1End)
    // The PTB1 block must contain both register call splicing and the
    // create_collection move calls in a single Transaction.
    expect(block).toContain('intent.appendRegisterCalls(tx)')
    expect(block).toContain('appendCreateCollectionMoveCalls(tx, {')
    expect(block).toContain('created.finalizeCollection()')
    expect(block).toContain('created.finalizePersonalKiosk()')
    // Optional collection-right listing branch in the same PTB1.
    expect(block).toContain('list_collection_right_fixed_price')
    expect(block).toContain('finalize_collection_listing')
  })

  it('empty collections finalize via buildCollectionCoverCertifyTx with a single second signature', () => {
    const src = readSource(HOOK)
    const phase = src.indexOf('// ── Phase 5: Empty-collection branch')
    const phaseEnd = src.indexOf('// ── Phase 6:', phase)
    expect(phase).toBeGreaterThanOrEqual(0)
    expect(phaseEnd).toBeGreaterThan(phase)
    const block = src.slice(phase, phaseEnd)
    expect(block).toContain('buildCollectionCoverCertifyTx({')
    expect(block).toContain('completion!.attachCertifyCalls(tx, [coverIdx])')
    expect(block).toContain('recovery.coverCertifyDigest = coverResult.digest')
    expect(block).toContain('clearBatchRecovery()')
    // Must NOT enter chunked fallback for empty collections.
    expect(block).not.toContain('buildBatchPublishSoulTx(')
  })

  it('fast-path PTB2 uses explicit dryRun + bytes/gas caps + failure routing', () => {
    const src = readSource(HOOK)
    const fastStart = src.indexOf('async function tryFastPathPtb2')
    expect(fastStart).toBeGreaterThanOrEqual(0)
    const block = src.slice(fastStart)
    // Bytes computed via tx.build({ client, onlyTransactionKind: false }).
    expect(block).toContain('await tx.build({ client: suiClient as never, onlyTransactionKind: false })')
    // Explicit dry-run on the bytes — not the wallet's internal dry-run.
    expect(block).toContain('await suiClient.dryRunTransactionBlock({ transactionBlock: bytes })')
    // Configurable byte / gas caps.
    expect(block).toContain('FAST_PATH_BYTES_CAP')
    expect(block).toContain('FAST_PATH_GAS_CAP_MIST')
    // Object-missing / version mismatch surfaces as session expired (no fallback).
    expect(block).toContain('FastPathSessionExpired')
    expect(block).toMatch(/\/missing object\|changed object\|not exist\|version\/i/)
    // Other failures fall back to chunked.
    expect(block).toContain('FastPathFallback')
    // signAndExecute returning failure also falls back.
    expect(block).toContain("status?.status !== 'success'")
  })

  it('does not enter chunked fallback after PTB2 has already settled on-chain', () => {
    const src = readSource(HOOK)
    const fastStart = src.indexOf('async function tryFastPathPtb2')
    expect(fastStart).toBeGreaterThanOrEqual(0)
    const block = src.slice(fastStart)

    expect(src).toContain('class FastPathMirrorFailed extends Error')
    expect(src).toContain('async function mirrorFastPathPtb2')
    expect(src).toContain('if (recovery.fastPathPtb2Digest && recovery.souls.some')
    expect(src).toContain('await mirrorFastPathPtb2({')
    expect(src).toContain('throw new FastPathMirrorFailed')
    expect(block).not.toContain('throw new FastPathFallback(`batch mirror failed')
    expect(block).not.toContain('throw new FastPathFallback(`fast-path TX produced')
  })

  it('fast-path attempt counter blocks re-attempts after one failure', () => {
    const src = readSource(HOOK)
    expect(src).toContain('interface FastPathAttempt {')
    expect(src).toContain('count: number')
    expect(src).toContain('lastError: string | null')
    expect(src).toContain('fastPathAttempt: FastPathAttempt | null')
    expect(src).toContain('const fastPathBlocked = (recovery.fastPathAttempt?.count ?? 0) >= 1')
    expect(src).toContain('count: (recovery.fastPathAttempt?.count ?? 0) + 1')
  })

  it('chunked fallback attaches the cover cert to the FIRST unsigned mint chunk only', () => {
    const src = readSource(HOOK)
    const phase = src.indexOf('// ── Phase 7: Chunked fallback')
    const phaseEnd = src.indexOf('// ── Phase 8:', phase)
    expect(phase).toBeGreaterThanOrEqual(0)
    expect(phaseEnd).toBeGreaterThan(phase)
    const block = src.slice(phase, phaseEnd)
    expect(block).toContain('const includeCoverCert = !recovery.coverCertifyDigest')
    expect(block).toContain('includeCoverCert\n            ? [layout.cover, ...chunkCertIndices]\n            : chunkCertIndices')
    expect(block).toContain('if (includeCoverCert) {\n            recovery.coverCertifyDigest = chunkDigest\n          }')
  })

  it('chunked fallback mirrors each mint chunk through /api/souls/publish/batch and maps syncs by chunk index', () => {
    const src = readSource(HOOK)
    const phase = src.indexOf('// ── Phase 7: Chunked fallback')
    const phaseEnd = src.indexOf('// ── Phase 8:', phase)
    expect(phase).toBeGreaterThanOrEqual(0)
    expect(phaseEnd).toBeGreaterThan(phase)
    const block = src.slice(phase, phaseEnd)

    expect(block).toContain("fetch('/api/souls/publish/batch'")
    expect(block).toContain('expectedSoulCount: chunk.soulIndices.length')
    expect(block).toContain('expectedBindCount: 0')
    expect(block).toContain('const soulIdx = chunk.soulIndices[i]')
    expect(block).toContain('recovery.souls[soulIdx].mintSync =')
    expect(block).not.toContain('for (const sb of syncBodies)')
    expect(block).not.toContain("fetch('/api/souls/publish',")
  })

  it('beforeunload guard installs during the sliver upload phase and removes on exit', () => {
    const src = readSource(HOOK)
    expect(src).toContain('function installBeforeUnloadGuard(message: string)')
    expect(src).toContain('removeBeforeUnloadGuard = installBeforeUnloadGuard')
    expect(src).toContain('Walrus is uploading slivers')
    expect(src).toContain("removeBeforeUnloadGuard?.()")
  })

  it('waits for PTB1 finality before mirror create so PTB2 dry-run can read initialSharedVersion', () => {
    const src = readSource(HOOK)
    expect(src).toContain('await suiClient.waitForTransaction({')
    expect(src).toContain('digest: recovery.collectionPtb1Digest')
    expect(src).toContain('options: { showEffects: true }')
  })

  it('recovery v12 uses fastPathPtb2Digest naming consistently', () => {
    const src = readSource(HOOK)
    expect(src).toContain('fastPathPtb2Digest: string | null')
    // Old field names from earlier drafts must NOT appear.
    expect(src).not.toContain('fastPathDigest')
    expect(src).not.toContain('fastPathTxDigest')
  })

  it('v11 → v12 migration: a v11 blob is dropped on hydrate', () => {
    const src = readSource(HOOK)
    expect(src).toMatch(/parsed\.version !== RECOVERY_VERSION/)
    expect(src).toContain('// v11 (or earlier) drafts are discarded — schema is incompatible.')
  })
})

describe('use-publish single-signAndExecute regression (CRITICAL)', () => {
  it('publish() invokes signAndExecute exactly once per call', () => {
    const src = readSource(PUBLISH_HOOK)
    // The hook must never sign more than one PTB. Bind / list now live in
    // the same PTB as mint.
    const occurrences = (src.match(/await signAndExecute\(/g) ?? []).length
    expect(occurrences).toBe(1)
  })

  it('selects the correct builder for each publishMode', () => {
    const src = readSource(PUBLISH_HOOK)
    expect(src).toContain('buildPublishSoulTx(baseBuilderParams)')
    expect(src).toContain('buildPublishSoulWithBindTx({')
    expect(src).toContain('buildPublishSoulWithListTx({')
    expect(src).toContain('buildPublishSoulWithCollectionAndListTx({')
  })

  it('mirrors publish → add-soul → list using the SAME digest', () => {
    const src = readSource(PUBLISH_HOOK)
    // All three mirror calls reference `digest` (the mint digest), not
    // a separate bind / list digest.
    expect(src).toContain("body: JSON.stringify({ txDigest: digest, soulOnChainId: syncData.soulOnChainId })")
    expect(src).toContain("body: JSON.stringify({ txDigest: digest })")
    // Any "second-signature bind branch" semantics is removed.
    expect(src).not.toContain('buildAddSoulToCollectionTx')
    expect(src).not.toContain("if (!collectionAddTxDigest)")
  })
})

describe('listing event extractors filter by route id', () => {
  it('extractAllSoulListedEvents and extractAllCollectionListedEvents are exported', () => {
    const src = readSource(EVENTS)
    expect(src).toContain('export function extractAllSoulListedEvents(')
    expect(src).toContain('export function extractAllCollectionListedEvents(')
    expect(src).toContain('parseSoulListedEvent')
    expect(src).toContain('parseCollectionListedEvent')
  })

  it('soul list route picks the SoulListed event whose soul_id matches the route soul', () => {
    const src = readSource(SOUL_LIST_ROUTE)
    expect(src).toContain('extractAllSoulListedEvents(transaction, packageId)')
    expect(src).toContain('listedEvents.find((e) => e.soulId === soul.onChainId)')
    expect(src).toContain('Transaction did not list this Soulidity object')
  })

  it('collection list route picks the CollectionListed event whose collection_id matches the route collection', () => {
    const src = readSource(COLLECTION_LIST_ROUTE)
    expect(src).toContain('extractAllCollectionListedEvents(transaction, packageId)')
    expect(src).toContain('listedEvents.find((e) => e.collectionId === collection.onChainId)')
  })
})

describe('/api/souls/publish/batch route shape', () => {
  it('reads TX once, validates expected*, then writes mirrors', () => {
    const src = readSource(BATCH_ROUTE)
    expect(src).toContain('extractAllSoulMintedToKioskEvents(transaction, packageId)')
    expect(src).toContain('extractAllSoulAddedToCollectionEvents(transaction, packageId)')
    expect(src).toContain('expectedSoulCount')
    expect(src).toContain('expectedBindCount')
    // Validates every bind targets the route collection.
    expect(src).toContain('bind.collectionId.toLowerCase() !== collection.onChainId.toLowerCase()')
    // Aborts on count mismatch.
    expect(src).toContain('but expectedSoulCount is')
    expect(src).toContain('but expectedBindCount is')
  })

  it('rejects per-soul body with a soulOnChainId not in the TX', () => {
    const src = readSource(BATCH_ROUTE)
    expect(src).toContain('mintByEventSoulId.has(sb.soulOnChainId.toLowerCase())')
    expect(src).toContain('has no matching SoulMintedToKiosk event in this TX')
  })

  it('uses the publish:batch tx-sync route key for dedup', () => {
    const src = readSource(BATCH_ROUTE)
    expect(src).toContain("routeKey: 'publish:batch'")
  })

  it('supports chunked mint-only batch mirrors with expectedBindCount = 0', () => {
    const src = readSource(BATCH_ROUTE)
    expect(src).toContain('expectedBindCount === 0 || expectedBindCount === expectedSoulCount')
    expect(src).toContain('const shouldMirrorCollectionBind = expectedBindCount > 0')
    expect(src).toContain('if (shouldMirrorCollectionBind)')
    expect(src).not.toContain('expectedBindCount must equal expectedSoulCount for the fast-path bundle')
  })
})

describe('smoke harness is executable, not a placeholder matrix', () => {
  it('does not contain placeholder row bodies or fake signature assignments', () => {
    const src = readSource(SMOKE)
    expect(src).not.toContain('placeholder body')
    expect(src).not.toContain('trace.signatures = 0')
    expect(src).not.toContain('note:')
  })

  it('defines concrete smoke rows as executable steps with signature assertions', () => {
    const src = readSource(SMOKE)
    expect(src).toContain('interface SmokeStep')
    expect(src).toContain('steps: SmokeStep[]')
    expect(src).toContain('runSmokeStep(')
    expect(src).toContain('expectedSignatures')
    expect(src).toContain('assertMirrorOk')
  })

  it('lets every mirror step assert response JSON, not only HTTP status', () => {
    const src = readSource(SMOKE)
    expect(src).toContain('assertBody?: SmokeJsonAssertion[]')
    expect(src).toContain('function assertMirrorBody')
    expect(src).toContain('resolveJsonPath(payload, assertion.path)')
    expect(src).toContain('mirror response assertion failed')
  })
})

describe('fast-path bench requires distinct live blob inputs', () => {
  it('uses one registered Blob object per soul instead of reusing the same blob in every row', () => {
    const src = readSource('scripts/bench-fast-path.ts')
    expect(src).toContain('BENCH_BLOB_IDS')
    expect(src).toContain('protectedBlobObjectIds')
    expect(src).toContain('protectedBlobObjectId: ins.protectedBlobObjectIds[i]')
    expect(src).not.toMatch(/protectedBlobObjectId:\s*ins\.protectedBlobObjectId(?!s)/)
  })
})
