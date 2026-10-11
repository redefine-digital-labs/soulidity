import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase64 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { profileReadStep } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'
import { assertWalrusBatchLifetime, walrusBatchCanonicalJson as canonical, type WalrusBatchLifetime } from '../upload/walrus-batch-preparation'
import { openWalrusBatchDatabase, parseWalrusBatchRecord, walrusBatchStoreKey, WALRUS_BATCH_STORE_CHANGED } from '../upload/walrus-batch-store'
import { parseSoulAuthoringTarget, type SoulAuthoringTarget } from './soul-authoring-manifest'
import { browserSoulAuthoringStore, soulAuthoringStoreKey, type SoulAuthoringPreparation } from './soul-authoring-store'
import { soulAuthoringCompletionKey } from './soul-authoring-completion'
import { exportSoulAuthoringRecovery, parseSoulAuthoringRecovery, readSoulAuthoringRecovery, type SoulAuthoringRecovery } from './soul-authoring-recovery'
import { createSoulAuthoringVerifier } from './soul-authoring-verifier'
import { readSoulAuthoringExpiry } from './soul-authoring-expiry'

function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`SOUL_AUTHORING_RESTORE_${code}`) }
function preparation(bundle: SoulAuthoringRecovery): SoulAuthoringPreparation {
  return { schema: 'soulidity.soul-authoring-preparation.v1', manifest: bundle.manifest, preparation: bundle.upload.preparation }
}
export function soulAuthoringRecoveryHref(bundle: Pick<SoulAuthoringRecovery, 'manifest'>) {
  const request = bundle.manifest.request
  return request.collection ? '/collections/create/preview' : request.mints[0]?.kind === 'JOINED'
    ? '/wrap-link/personal/preview' : request.mints[0]?.kind === 'IMPORTED' ? '/import/gas' : '/create/gas'
}
/** Read-only proof of imported checkpoints. Unknown current packets stay
 * unknown; they are never discarded or converted into a new paid operation. */
export async function proveSoulAuthoringRecovery(params: { bundle: SoulAuthoringRecovery; client: SuiGrpcClient;
  target: SoulAuthoringTarget; lifetime: WalrusBatchLifetime }) {
  const bundle = parseSoulAuthoringRecovery(params.bundle), p = preparation(bundle)
  const { client, lifetime } = params
  const guard = () => assertWalrusBatchLifetime(p.preparation.manifest.scope, lifetime)
  guard()
  check(canonical(p.manifest.request.target) === canonical(parseSoulAuthoringTarget(params.target)), 'DEPLOYMENT_MISMATCH')
  const info = await profileReadStep(lifetime.signal, () => client.ledgerService.getServiceInfo({}, { abort: lifetime.signal })); guard()
  check(info.response.chainId === MAINNET_GENESIS_DIGEST, 'CHAIN_MISMATCH')
  const verifier = createSoulAuthoringVerifier({ client, preparation: p,
    journal: { read: async () => bundle.head, history: async () => bundle.history },
    uploads: { read: async () => bundle.upload } })
  // Registration must be re-proved before querying a mint whose acceptance
  // was interrupted. Never trust an imported registration receipt as authority.
  const records = [...bundle.history, ...(bundle.head ? [bundle.head] : [])]
    .sort((a, b) => Number(b.plan.step.kind === 'REGISTER') - Number(a.plan.step.kind === 'REGISTER'))
  const consumptions: typeof bundle.upload.consumptions = [], minted: number[] = []
  let registerDigest: string | null = null
  for (const record of records) {
    guard()
    if (record.packet.signature) {
      await profileReadStep(lifetime.signal, () => verifyTransactionSignature(fromBase64(record.packet.bytes),
        record.packet.signature!, { address: p.manifest.request.author, client })); guard()
    }
    const result = await verifier.query(record, lifetime.signal); guard()
    if (['SUCCEEDED', 'FAILED'].includes(record.packet.phase)) check(result.status === record.packet.phase, 'TERMINAL_CONTRADICTION')
    if (result.status === 'SUCCEEDED') {
      check(!['FAILED', 'CANCELLED', 'RETIRED'].includes(record.packet.phase), 'TERMINAL_CONTRADICTION')
      if (record.plan.step.kind === 'REGISTER') {
        check(registerDigest === null, 'DUPLICATE_REGISTRATION'); registerDigest = record.packet.digest
        check(!bundle.upload.registration || canonical(bundle.upload.registration) === canonical(result.receipt.registration), 'REGISTER_CHANGED')
        bundle.upload.registration = result.receipt.registration
      } else {
        check(registerDigest && result.receipt.consumption, 'REGISTER_REQUIRED')
        const proof = result.receipt.consumption
        const prior = bundle.upload.consumptions.find(row => row.packet.digest === record.packet.digest)
        check(!prior || canonical(prior) === canonical(proof), 'CONSUMPTION_CHANGED')
        consumptions.push(proof)
        const indices = result.receipt.business.mints.map(mint => mint.mintIndex)
        check(canonical(indices) === canonical(record.plan.step.chunk.mintIndices), 'MINT_INDICES_CHANGED')
        minted.push(...indices)
      }
      record.packet.phase = 'SUCCEEDED'
    } else if (result.status === 'FAILED') record.packet.phase = 'FAILED'
    else {
      const isHead = bundle.head?.packet.digest === record.packet.digest
      if (!isHead && result.status === 'MISSING' && record.packet.phase === 'CANCELLED') {
        // A file cannot prove that a signature never existed on another device.
        // Only executed-checkpoint expiry plus a subsequent exact query permits
        // imported cancellation history to stop blocking replacement payment.
        const checkpoint = await readSoulAuthoringExpiry(client, record.packet.expirationEpoch, lifetime.signal); guard()
        const afterExpiry = await verifier.query(record, lifetime.signal); guard()
        check(afterExpiry.status === 'MISSING', 'CANCELLED_HISTORY_UNCONFIRMED')
        record.packet.phase = 'RETIRED'; record.retirement = { priorPhase: 'PREPARED', checkpoint }
      } else {
        check(isHead || result.status === 'MISSING' && record.packet.phase === 'RETIRED', 'UNRESOLVED_HISTORY')
        if (isHead && record.packet.phase === 'CANCELLED') record.packet.phase = 'SIGNING'
      }
    }
  }
  check(!bundle.upload.registration || bundle.upload.registration.packet.digest === registerDigest, 'UNPROVED_REGISTRATION')
  check(bundle.upload.consumptions.every(prior => consumptions.some(proof => canonical(prior) === canonical(proof))), 'UNPROVED_CONSUMPTION')
  minted.sort((a, b) => a - b)
  check(minted.every((index, position) => index === position), 'MINT_COVERAGE_CONFLICT')
  if (bundle.head && ['PREPARED', 'SIGNING', 'SIGNED'].includes(bundle.head.packet.phase)) {
    const step = bundle.head.plan.step
    if (step.kind === 'REGISTER') check(registerDigest === null, 'REGISTER_ALREADY_CONFIRMED')
    else {
      check(registerDigest && step.chunk.mintIndices.every((index, position) => index === minted.length + position), 'PENDING_MINT_COVERAGE_CONFLICT')
      const publicIndices = new Set(p.preparation.manifest.files.filter(file => file.uploadType === 'public').map(file => file.index))
      check(!step.chunk.includePublicFiles || !consumptions.some(proof => proof.indices.some(index => publicIndices.has(index))), 'PUBLIC_FILES_ALREADY_CONSUMED')
    }
  }
  bundle.upload = parseWalrusBatchRecord({ ...bundle.upload, consumptions })
  guard(); return parseSoulAuthoringRecovery(bundle)
}

/** Explicit local restore. One writer lock and one strict transaction install
 * all records, or none. Never merge/overwrite an existing or archived creation. */
export async function restoreSoulAuthoringRecovery(params: Parameters<typeof proveSoulAuthoringRecovery>[0]) {
  const input = parseSoulAuthoringRecovery(params.bundle), p = preparation(input)
  const parentKey = soulAuthoringStoreKey(p.manifest.request), packetKey = `${parentKey}:packets`
  const batchKey = walrusBatchStoreKey(p.preparation.manifest.scope), prefix = `${packetKey}:history:`
  const guard = () => assertWalrusBatchLifetime(p.preparation.manifest.scope, params.lifetime)
  const store = browserSoulAuthoringStore()
  return store.exclusive(parentKey, async () => {
    guard()
    const bundle = await proveSoulAuthoringRecovery({ ...params, bundle: input }); guard()
    const prior = await store.read(parentKey); guard()
    if (prior) {
      const existing = await readSoulAuthoringRecovery(prior); guard()
      check(exportSoulAuthoringRecovery(existing) === exportSoulAuthoringRecovery(bundle), 'LOCAL_CREATION_EXISTS_OPEN_SAVED')
      return soulAuthoringRecoveryHref(bundle)
    }
    const db = await openWalrusBatchDatabase()
    try {
      guard()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['authoring', 'active', 'authoring-packets', 'archive'], 'readwrite', { durability: 'strict' })
        const parents = tx.objectStore('authoring'), uploads = tx.objectStore('active'), packets = tx.objectStore('authoring-packets')
        const parent = parents.get(parentKey), upload = uploads.get(batchKey), head = packets.get(packetKey)
        const archived = tx.objectStore('archive').get(soulAuthoringCompletionKey(p))
        const history = packets.count(IDBKeyRange.bound(prefix, `${prefix}\uffff`))
        let cause: unknown
        tx.onabort = () => reject(cause ?? new Error('SOUL_AUTHORING_RESTORE_WRITE_FAILED', { cause: tx.error }))
        tx.oncomplete = () => resolve()
        history.onsuccess = () => { try {
          guard()
          check(parent.result === undefined && upload.result === undefined && head.result === undefined
            && history.result === 0, 'LOCAL_CREATION_EXISTS_OPEN_SAVED')
          check(archived.result === undefined, 'ALREADY_ARCHIVED_OPEN_COMPLETION')
          parents.add({ schema: 'soulidity.soul-authoring-parent.v1', manifest: bundle.manifest, batchKey }, parentKey)
          uploads.add(bundle.upload, batchKey)
          if (bundle.head) packets.add(bundle.head, packetKey)
          for (const record of bundle.history) packets.add(record, `${prefix}${record.packet.digest}:${record.packet.phase}`)
        } catch (error) { cause = error; tx.abort() } }
      })
      const saved = await readSoulAuthoringRecovery(p)
      check(exportSoulAuthoringRecovery(saved) === exportSoulAuthoringRecovery(bundle), 'READBACK_MISMATCH')
      guard()
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(WALRUS_BATCH_STORE_CHANGED))
      return soulAuthoringRecoveryHref(bundle)
    } finally { db.close() }
  })
}
