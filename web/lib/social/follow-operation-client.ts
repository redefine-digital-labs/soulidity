import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase58, fromBase64, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { assertWalletSocialDeployment, buildSetWalletFollowTx, readWalletFollowState, profileReadStep,
  createWalletFollowIntent, parseWalletFollowOperation, walletFollowOperationKey,
  type WalletFollowIntent, type WalletFollowOperation, type WalletFollowOperationAdapter,
  type WalletFollowOperationStore, type WalletSocialDeployment } from '@soulidity/sdk'

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

export function browserWalletFollowOperationStore(): WalletFollowOperationStore {
  check(typeof window !== 'undefined' && navigator.locks?.request, 'FOLLOW_RECOVERY_REQUIRES_STORAGE_AND_LOCKS')
  const storage = window.localStorage
  return {
    exclusive: (key, work) => navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
      check(lock, 'FOLLOW_OPERATION_BUSY_IN_ANOTHER_TAB'); return work()
    }),
    read: key => {
      const raw = storage.getItem(key)
      if (raw === null) return null
      check(raw.length <= 65536, 'FOLLOW_RECOVERY_RECORD_TOO_LARGE')
      const record = parseWalletFollowOperation(JSON.parse(raw))
      check(walletFollowOperationKey(record.intent) === key, 'FOLLOW_OPERATION_SCOPE_MISMATCH')
      return record
    },
    write: (key, input) => {
      const record = parseWalletFollowOperation(input)
      check(walletFollowOperationKey(record.intent) === key, 'FOLLOW_OPERATION_SCOPE_MISMATCH')
      const encoded = JSON.stringify(record)
      check(encoded.length <= 65536, 'FOLLOW_RECOVERY_RECORD_TOO_LARGE')
      storage.setItem(key, encoded)
      check(storage.getItem(key) === encoded, 'FOLLOW_RECOVERY_PERSISTENCE_FAILED')
    },
  }
}

/** Concrete browser adapter: frozen CAS transaction, real wallet signature,
 * public gRPC evidence. Local phases are never evidence of chain completion. */
export function createWalletFollowOperationClient(params: {
  client: SuiGrpcClient
  deployment: WalletSocialDeployment
  writesEnabled: () => boolean
  getAddress: () => string | null
  sign: (transaction: Transaction) => Promise<{ bytes: string; signature: string }>
}): { prepare: (intent: WalletFollowIntent) => Promise<WalletFollowOperation>; adapter: WalletFollowOperationAdapter } {
  const deployment = assertWalletSocialDeployment(params.deployment)
  // Use the same canonical scope serialization as the operation parser.
  const scopeKey = (intent: WalletFollowIntent) => walletFollowOperationKey({ ...intent, deployment })
  const { client, writesEnabled, getAddress, sign } = params
  async function chain() {
    const { chainIdentifier } = await profileReadStep(timeout(), () => client.core.getChainIdentifier())
    const digest = fromBase58(chainIdentifier)
    check(digest.length === 32 && toBase58(digest) === chainIdentifier
      && toHex(digest.subarray(0, 4)) === deployment.profile.chainIdentifier, 'FOLLOW_WRONG_CHAIN')
  }
  async function epoch() {
    const { response } = await profileReadStep(timeout(), () => client.ledgerService.getEpoch({ readMask: { paths: ['epoch'] } }))
    check(typeof response.epoch?.epoch === 'bigint' && response.epoch.epoch >= 0n && response.epoch.epoch < MAX_U64,
      'FOLLOW_CURRENT_EPOCH_UNAVAILABLE')
    return response.epoch.epoch
  }
  function writable(owner: string) {
    check(writesEnabled(), 'FOLLOW_WRITES_DISABLED')
    check(getAddress() === owner, 'FOLLOW_RECONNECT_PREPARING_WALLET')
  }
  function scope(intent: WalletFollowIntent) {
    const expected = createWalletFollowIntent({ ...intent, deployment })
    check(walletFollowOperationKey(intent) === scopeKey(intent)
      && JSON.stringify(intent.deployment) === JSON.stringify(expected.deployment), 'FOLLOW_RELEASE_CHANGED')
  }
  async function current(intent: WalletFollowIntent) {
    const snapshot = await readWalletFollowState({ client, deployment, targetProfileId: intent.targetId,
      viewerAddress: intent.owner, signal: timeout() })
    check(snapshot.viewer?.id === intent.actorId && snapshot.viewer.owner === intent.owner
      && snapshot.target.id === intent.targetId && snapshot.target.owner === intent.targetOwner, 'FOLLOW_IDENTITY_CHANGED')
    check(snapshot.edgeRevision === intent.expectedRevision, 'FOLLOW_CHANGED_RELOAD_REQUIRED')
    check(snapshot.following !== intent.following, 'FOLLOW_ALREADY_CURRENT')
    check(BigInt(snapshot.edgeRevision) < MAX_U64, 'FOLLOW_REVISION_EXHAUSTED')
  }
  const adapter: WalletFollowOperationAdapter = {
    async preflight(input, signing) {
      const record = parseWalletFollowOperation(input)
      scope(record.intent); writable(record.intent.owner); await chain()
      if (signing) await current(record.intent)
      check(await epoch() <= BigInt(record.expirationEpoch), 'FOLLOW_TRANSACTION_EXPIRED_QUERY_ONLY')
      writable(record.intent.owner)
    },
    async sign(input) {
      const record = parseWalletFollowOperation(input)
      check(record.phase === 'PREPARED' || record.phase === 'SIGNING', 'FOLLOW_OPERATION_NOT_SIGNABLE')
      scope(record.intent); writable(record.intent.owner)
      return bounded(() => sign(Transaction.from(fromBase64(record.bytes))), 120000, 'FOLLOW_SIGNING_TIMEOUT_QUERY_SAVED_TRANSACTION')
    },
    async verifySignature(input) {
      const record = parseWalletFollowOperation(input)
      scope(record.intent); check(record.signature, 'FOLLOW_SIGNATURE_REQUIRED')
      await bounded(() => verifyTransactionSignature(fromBase64(record.bytes), record.signature!, { address: record.intent.owner, client }),
        15000, 'FOLLOW_SIGNATURE_CHECK_TIMEOUT_QUERY_SAVED_TRANSACTION')
    },
    async broadcast(input) {
      const record = parseWalletFollowOperation(input)
      scope(record.intent); writable(record.intent.owner)
      check(record.phase === 'SIGNED' && record.signature, 'FOLLOW_SIGNATURE_REQUIRED')
      // A deadline releases the WebLock without declaring transaction failure.
      // The exact signed record survives; a late result is recovered by digest.
      await bounded(() => client.core.executeTransaction({ transaction: fromBase64(record.bytes), signatures: [record.signature!] }),
        30000, 'FOLLOW_BROADCAST_TIMEOUT_QUERY_SAVED_TRANSACTION')
    },
    async query(input) {
      const record = parseWalletFollowOperation(input)
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
      'FOLLOW_TRANSACTION_EVIDENCE_MISMATCH')
      const bytes = value.effects.bcs.value, decoded = bcs.TransactionEffects.parse(bytes)
      check(toBase64(bcs.TransactionEffects.serialize(decoded).toBytes()) === toBase64(bytes), 'FOLLOW_EFFECTS_NONCANONICAL')
      const effects = decoded.V2 ?? decoded.V1
      check(effects?.transactionDigest === record.digest && ['Success', 'Failure'].includes(effects.status.$kind)
        && value.effects.status?.success === (effects.status.$kind === 'Success')
        && BigInt(effects.executedEpoch) <= BigInt(record.expirationEpoch), 'FOLLOW_TRANSACTION_STATUS_MISMATCH')
      if (value.checkpoint === undefined) return 'PENDING'
      check(typeof value.checkpoint === 'bigint' && value.checkpoint >= 0n && value.checkpoint <= MAX_U64, 'FOLLOW_CHECKPOINT_INVALID')
      return effects.status.$kind === 'Success' ? 'SUCCEEDED' : 'FAILED'
    },
  }
  return {
    adapter,
    async prepare(input) {
      const intent = createWalletFollowIntent(input)
      scope(intent); writable(intent.owner); await chain(); await current(intent)
      const tx = buildSetWalletFollowTx(intent)
      const expirationEpoch = String(await epoch() + 1n)
      tx.setExpiration({ Epoch: expirationEpoch })
      const bytes = await bounded(() => tx.build({ client }), 15000, 'FOLLOW_PREPARATION_TIMEOUT_RETRY')
      writable(intent.owner)
      return parseWalletFollowOperation({ schema: 'soulidity.wallet-follow-operation.v1', intent,
        bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch, phase: 'PREPARED', signature: null })
    },
  }
}
