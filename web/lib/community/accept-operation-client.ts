import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase58, fromBase64, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { assertPublicCommunityDeployment, buildAcceptPublicCommunityAnswerTx, profileReadStep,
  createPublicCommunityAcceptIntent, parsePublicCommunityAcceptOperation, publicCommunityAcceptOperationKey,
  type PublicCommunityAcceptIntent, type PublicCommunityAcceptOperation, type PublicCommunityAcceptOperationAdapter,
  type PublicCommunityAcceptOperationStore, type PublicCommunityDeployment } from '@soulidity/sdk'
import { assertCommunityAcceptanceReady } from './accept-preflight'

function check(value: unknown, code: string): asserts value { if (!value) throw new Error(code) }
const timeout = () => AbortSignal.timeout(15000)
const MAX_U64 = 18446744073709551615n

/** Bound the caller even when an SDK/wallet ignores cancellation. A timed-out
 * signature/send is unknown, never failed; its durable operation is retained.
 * Late fulfillment is observed but cannot resume the abandoned continuation. */
async function bounded<T>(run: () => Promise<T>, milliseconds: number, code: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(code)), milliseconds)
  try { return await profileReadStep(controller.signal, run) }
  finally { clearTimeout(timer) }
}

export function browserPublicCommunityAcceptOperationStore(): PublicCommunityAcceptOperationStore {
  check(typeof window !== 'undefined' && navigator.locks?.request, 'COMMUNITY_ACCEPT_RECOVERY_REQUIRES_STORAGE_AND_LOCKS')
  const storage = window.localStorage
  return {
    exclusive: (key, work) => navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
      check(lock, 'COMMUNITY_ACCEPT_OPERATION_BUSY_IN_ANOTHER_TAB'); return work()
    }),
    read: key => {
      const raw = storage.getItem(key)
      if (raw === null) return null
      check(raw.length <= 65536, 'COMMUNITY_ACCEPT_RECOVERY_RECORD_TOO_LARGE')
      const record = parsePublicCommunityAcceptOperation(JSON.parse(raw))
      check(publicCommunityAcceptOperationKey(record.intent) === key, 'COMMUNITY_ACCEPT_OPERATION_SCOPE_MISMATCH')
      return record
    },
    write: (key, input) => {
      const record = parsePublicCommunityAcceptOperation(input)
      check(publicCommunityAcceptOperationKey(record.intent) === key, 'COMMUNITY_ACCEPT_OPERATION_SCOPE_MISMATCH')
      const encoded = JSON.stringify(record)
      check(encoded.length <= 65536, 'COMMUNITY_ACCEPT_RECOVERY_RECORD_TOO_LARGE')
      storage.setItem(key, encoded)
      check(storage.getItem(key) === encoded, 'COMMUNITY_ACCEPT_RECOVERY_PERSISTENCE_FAILED')
    },
  }
}

/** Concrete browser adapter: frozen CAS transaction, real wallet signature,
 * public gRPC evidence. Local phases are never evidence of chain completion. */
export function createPublicCommunityAcceptOperationClient(params: {
  client: SuiGrpcClient
  deployment: PublicCommunityDeployment
  writesEnabled: () => boolean
  getAddress: () => string | null
  sign: (transaction: Transaction) => Promise<{ bytes: string; signature: string }>
}): { prepare: (intent: PublicCommunityAcceptIntent) => Promise<PublicCommunityAcceptOperation>; adapter: PublicCommunityAcceptOperationAdapter } {
  const deployment = assertPublicCommunityDeployment(params.deployment)
  // Use the same canonical scope serialization as the operation parser.
  const scopeKey = (intent: PublicCommunityAcceptIntent) => publicCommunityAcceptOperationKey({ ...intent, deployment })
  const { client, writesEnabled, getAddress, sign } = params
  async function chain() {
    const { chainIdentifier } = await profileReadStep(timeout(), () => client.core.getChainIdentifier())
    const digest = fromBase58(chainIdentifier)
    check(digest.length === 32 && toBase58(digest) === chainIdentifier
      && toHex(digest.subarray(0, 4)) === deployment.profile.chainIdentifier, 'COMMUNITY_ACCEPT_WRONG_CHAIN')
  }
  async function epoch() {
    const { response } = await profileReadStep(timeout(), () => client.ledgerService.getEpoch({ readMask: { paths: ['epoch'] } }))
    check(typeof response.epoch?.epoch === 'bigint' && response.epoch.epoch >= 0n && response.epoch.epoch < MAX_U64,
      'COMMUNITY_ACCEPT_CURRENT_EPOCH_UNAVAILABLE')
    return response.epoch.epoch
  }
  function writable(owner: string) {
    check(writesEnabled(), 'COMMUNITY_ACCEPT_WRITES_DISABLED')
    check(getAddress() === owner, 'COMMUNITY_ACCEPT_RECONNECT_PREPARING_WALLET')
  }
  function scope(intent: PublicCommunityAcceptIntent) {
    const expected = createPublicCommunityAcceptIntent({ ...intent, deployment })
    check(publicCommunityAcceptOperationKey(intent) === scopeKey(intent)
      && JSON.stringify(intent.deployment) === JSON.stringify(expected.deployment), 'COMMUNITY_ACCEPT_RELEASE_CHANGED')
  }
  async function current(intent: PublicCommunityAcceptIntent, signing: boolean) {
    await assertCommunityAcceptanceReady({ client, intent, signing })
  }
  const adapter: PublicCommunityAcceptOperationAdapter = {
    async preflight(input, signing) {
      const record = parsePublicCommunityAcceptOperation(input)
      scope(record.intent); writable(record.intent.owner); await chain()
      await current(record.intent, signing)
      check(await epoch() <= BigInt(record.expirationEpoch), 'COMMUNITY_ACCEPT_TRANSACTION_EXPIRED_QUERY_ONLY')
      writable(record.intent.owner)
    },
    async sign(input) {
      const record = parsePublicCommunityAcceptOperation(input)
      check(record.phase === 'PREPARED' || record.phase === 'SIGNING', 'COMMUNITY_ACCEPT_OPERATION_NOT_SIGNABLE')
      scope(record.intent); writable(record.intent.owner)
      return bounded(() => sign(Transaction.from(fromBase64(record.bytes))), 120000, 'COMMUNITY_ACCEPT_SIGNING_TIMEOUT_QUERY_SAVED_TRANSACTION')
    },
    async verifySignature(input) {
      const record = parsePublicCommunityAcceptOperation(input)
      scope(record.intent); check(record.signature, 'COMMUNITY_ACCEPT_SIGNATURE_REQUIRED')
      await bounded(() => verifyTransactionSignature(fromBase64(record.bytes), record.signature!, { address: record.intent.owner, client }),
        15000, 'COMMUNITY_ACCEPT_SIGNATURE_CHECK_TIMEOUT_QUERY_SAVED_TRANSACTION')
    },
    async broadcast(input) {
      const record = parsePublicCommunityAcceptOperation(input)
      scope(record.intent); writable(record.intent.owner)
      check(record.phase === 'SIGNED' && record.signature, 'COMMUNITY_ACCEPT_SIGNATURE_REQUIRED')
      // A deadline releases the WebLock without declaring transaction failure.
      // The exact signed record survives; a late result is recovered by digest.
      await bounded(() => client.core.executeTransaction({ transaction: fromBase64(record.bytes), signatures: [record.signature!] }),
        30000, 'COMMUNITY_ACCEPT_BROADCAST_TIMEOUT_QUERY_SAVED_TRANSACTION')
    },
    async query(input) {
      const record = parsePublicCommunityAcceptOperation(input)
      scope(record.intent); await chain()
      let response
      try {
        response = (await profileReadStep(timeout(), () => client.ledgerService.getTransaction({ digest: record.digest,
          readMask: { paths: ['digest', 'transaction.digest', 'transaction.bcs', 'effects.bcs',
            'effects.transaction_digest', 'effects.status', 'checkpoint'] } }))).response
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return 'MISSING'
        throw error
      }
      const value = response.transaction
      check(value?.digest === record.digest && value.transaction?.digest === record.digest
        && value.transaction.bcs?.value && toBase64(value.transaction.bcs.value) === record.bytes
        && value.effects?.transactionDigest === record.digest && value.effects.bcs?.value,
      'COMMUNITY_ACCEPT_TRANSACTION_EVIDENCE_MISMATCH')
      const bytes = value.effects.bcs.value, decoded = bcs.TransactionEffects.parse(bytes)
      check(toBase64(bcs.TransactionEffects.serialize(decoded).toBytes()) === toBase64(bytes), 'COMMUNITY_ACCEPT_EFFECTS_NONCANONICAL')
      const effects = decoded.V2 ?? decoded.V1
      check(effects?.transactionDigest === record.digest && ['Success', 'Failure'].includes(effects.status.$kind)
        && value.effects.status?.success === (effects.status.$kind === 'Success')
        && BigInt(effects.executedEpoch) <= BigInt(record.expirationEpoch), 'COMMUNITY_ACCEPT_TRANSACTION_STATUS_MISMATCH')
      if (value.checkpoint === undefined) return 'PENDING'
      check(typeof value.checkpoint === 'bigint' && value.checkpoint >= 0n && value.checkpoint <= MAX_U64, 'COMMUNITY_ACCEPT_CHECKPOINT_INVALID')
      return effects.status.$kind === 'Success' ? 'SUCCEEDED' : 'FAILED'
    },
  }
  return {
    adapter,
    async prepare(input) {
      const intent = createPublicCommunityAcceptIntent(input)
      scope(intent); writable(intent.owner); await chain(); await current(intent, true)
      const tx = buildAcceptPublicCommunityAnswerTx(intent)
      const expirationEpoch = String(await epoch() + 1n)
      tx.setExpiration({ Epoch: expirationEpoch })
      const bytes = await bounded(() => tx.build({ client }), 15000, 'COMMUNITY_ACCEPT_PREPARATION_TIMEOUT_RETRY')
      writable(intent.owner)
      return parsePublicCommunityAcceptOperation({ schema: 'soulidity.community-accept-operation.v1', intent,
        bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch, phase: 'PREPARED', signature: null })
    },
  }
}

