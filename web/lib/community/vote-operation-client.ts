import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase58, fromBase64, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { assertPublicCommunityVotesDeployment, buildSetPublicCommunityVoteTx, readPublicCommunityVotes, profileReadStep,
  createPublicCommunityVoteIntent, parsePublicCommunityVoteOperation, publicCommunityVoteOperationKey,
  type PublicCommunityVoteIntent, type PublicCommunityVoteOperation, type PublicCommunityVoteOperationAdapter,
  type PublicCommunityVoteOperationStore, type PublicCommunityVotesDeployment } from '@soulidity/sdk'

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

export function browserPublicCommunityVoteOperationStore(): PublicCommunityVoteOperationStore {
  check(typeof window !== 'undefined' && navigator.locks?.request, 'COMMUNITY_VOTE_RECOVERY_REQUIRES_STORAGE_AND_LOCKS')
  const storage = window.localStorage
  return {
    exclusive: (key, work) => navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
      check(lock, 'COMMUNITY_VOTE_OPERATION_BUSY_IN_ANOTHER_TAB'); return work()
    }),
    read: key => {
      const raw = storage.getItem(key)
      if (raw === null) return null
      check(raw.length <= 65536, 'COMMUNITY_VOTE_RECOVERY_RECORD_TOO_LARGE')
      const record = parsePublicCommunityVoteOperation(JSON.parse(raw))
      check(publicCommunityVoteOperationKey(record.intent) === key, 'COMMUNITY_VOTE_OPERATION_SCOPE_MISMATCH')
      return record
    },
    write: (key, input) => {
      const record = parsePublicCommunityVoteOperation(input)
      check(publicCommunityVoteOperationKey(record.intent) === key, 'COMMUNITY_VOTE_OPERATION_SCOPE_MISMATCH')
      const encoded = JSON.stringify(record)
      check(encoded.length <= 65536, 'COMMUNITY_VOTE_RECOVERY_RECORD_TOO_LARGE')
      storage.setItem(key, encoded)
      check(storage.getItem(key) === encoded, 'COMMUNITY_VOTE_RECOVERY_PERSISTENCE_FAILED')
    },
  }
}

/** Concrete browser adapter: frozen CAS transaction, real wallet signature,
 * public gRPC evidence. Local phases are never evidence of chain completion. */
export function createPublicCommunityVoteOperationClient(params: {
  client: SuiGrpcClient
  deployment: PublicCommunityVotesDeployment
  writesEnabled: () => boolean
  getAddress: () => string | null
  sign: (transaction: Transaction) => Promise<{ bytes: string; signature: string }>
}): { prepare: (intent: PublicCommunityVoteIntent) => Promise<PublicCommunityVoteOperation>; adapter: PublicCommunityVoteOperationAdapter } {
  const deployment = assertPublicCommunityVotesDeployment(params.deployment)
  // Use the same canonical scope serialization as the operation parser.
  const scopeKey = (intent: PublicCommunityVoteIntent) => publicCommunityVoteOperationKey({ ...intent, deployment })
  const { client, writesEnabled, getAddress, sign } = params
  async function chain() {
    const { chainIdentifier } = await profileReadStep(timeout(), () => client.core.getChainIdentifier())
    const digest = fromBase58(chainIdentifier)
    check(digest.length === 32 && toBase58(digest) === chainIdentifier
      && toHex(digest.subarray(0, 4)) === deployment.community.profile.chainIdentifier, 'COMMUNITY_VOTE_WRONG_CHAIN')
  }
  async function epoch() {
    const { response } = await profileReadStep(timeout(), () => client.ledgerService.getEpoch({ readMask: { paths: ['epoch'] } }))
    check(typeof response.epoch?.epoch === 'bigint' && response.epoch.epoch >= 0n && response.epoch.epoch < MAX_U64,
      'COMMUNITY_VOTE_CURRENT_EPOCH_UNAVAILABLE')
    return response.epoch.epoch
  }
  function writable(owner: string) {
    check(writesEnabled(), 'COMMUNITY_VOTE_WRITES_DISABLED')
    check(getAddress() === owner, 'COMMUNITY_VOTE_RECONNECT_PREPARING_WALLET')
  }
  function scope(intent: PublicCommunityVoteIntent) {
    const expected = createPublicCommunityVoteIntent({ ...intent, deployment })
    check(publicCommunityVoteOperationKey(intent) === scopeKey(intent)
      && JSON.stringify(intent.deployment) === JSON.stringify(expected.deployment), 'COMMUNITY_VOTE_RELEASE_CHANGED')
  }
  async function current(intent: PublicCommunityVoteIntent) {
    const snapshot = await readPublicCommunityVotes({ client, deployment, postId: intent.postId,
      viewerAddress: intent.owner, signal: timeout() })
    check(snapshot.viewer?.id === intent.actorId && snapshot.viewer.owner === intent.owner
      && snapshot.post.id === intent.postId, 'COMMUNITY_VOTE_IDENTITY_CHANGED')
    check(snapshot.revision === intent.expectedRevision, 'COMMUNITY_VOTE_CHANGED_RELOAD_REQUIRED')
    check(snapshot.state !== intent.desired, 'COMMUNITY_VOTE_ALREADY_CURRENT')
    check(BigInt(snapshot.revision) < MAX_U64, 'COMMUNITY_VOTE_REVISION_EXHAUSTED')
  }
  const adapter: PublicCommunityVoteOperationAdapter = {
    async preflight(input, signing) {
      const record = parsePublicCommunityVoteOperation(input)
      scope(record.intent); writable(record.intent.owner); await chain()
      if (signing) await current(record.intent)
      check(await epoch() <= BigInt(record.expirationEpoch), 'COMMUNITY_VOTE_TRANSACTION_EXPIRED_QUERY_ONLY')
      writable(record.intent.owner)
    },
    async sign(input) {
      const record = parsePublicCommunityVoteOperation(input)
      check(record.phase === 'PREPARED' || record.phase === 'SIGNING', 'COMMUNITY_VOTE_OPERATION_NOT_SIGNABLE')
      scope(record.intent); writable(record.intent.owner)
      return bounded(() => sign(Transaction.from(fromBase64(record.bytes))), 120000, 'COMMUNITY_VOTE_SIGNING_TIMEOUT_QUERY_SAVED_TRANSACTION')
    },
    async verifySignature(input) {
      const record = parsePublicCommunityVoteOperation(input)
      scope(record.intent); check(record.signature, 'COMMUNITY_VOTE_SIGNATURE_REQUIRED')
      await bounded(() => verifyTransactionSignature(fromBase64(record.bytes), record.signature!, { address: record.intent.owner, client }),
        15000, 'COMMUNITY_VOTE_SIGNATURE_CHECK_TIMEOUT_QUERY_SAVED_TRANSACTION')
    },
    async broadcast(input) {
      const record = parsePublicCommunityVoteOperation(input)
      scope(record.intent); writable(record.intent.owner)
      check(record.phase === 'SIGNED' && record.signature, 'COMMUNITY_VOTE_SIGNATURE_REQUIRED')
      // A deadline releases the WebLock without declaring transaction failure.
      // The exact signed record survives; a late result is recovered by digest.
      await bounded(() => client.core.executeTransaction({ transaction: fromBase64(record.bytes), signatures: [record.signature!] }),
        30000, 'COMMUNITY_VOTE_BROADCAST_TIMEOUT_QUERY_SAVED_TRANSACTION')
    },
    async query(input) {
      const record = parsePublicCommunityVoteOperation(input)
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
      'COMMUNITY_VOTE_TRANSACTION_EVIDENCE_MISMATCH')
      const bytes = value.effects.bcs.value, decoded = bcs.TransactionEffects.parse(bytes)
      check(toBase64(bcs.TransactionEffects.serialize(decoded).toBytes()) === toBase64(bytes), 'COMMUNITY_VOTE_EFFECTS_NONCANONICAL')
      const effects = decoded.V2 ?? decoded.V1
      check(effects?.transactionDigest === record.digest && ['Success', 'Failure'].includes(effects.status.$kind)
        && value.effects.status?.success === (effects.status.$kind === 'Success')
        && BigInt(effects.executedEpoch) <= BigInt(record.expirationEpoch), 'COMMUNITY_VOTE_TRANSACTION_STATUS_MISMATCH')
      if (value.checkpoint === undefined) return 'PENDING'
      check(typeof value.checkpoint === 'bigint' && value.checkpoint >= 0n && value.checkpoint <= MAX_U64, 'COMMUNITY_VOTE_CHECKPOINT_INVALID')
      return effects.status.$kind === 'Success' ? 'SUCCEEDED' : 'FAILED'
    },
  }
  return {
    adapter,
    async prepare(input) {
      const intent = createPublicCommunityVoteIntent(input)
      scope(intent); writable(intent.owner); await chain(); await current(intent)
      const tx = buildSetPublicCommunityVoteTx(intent)
      const expirationEpoch = String(await epoch() + 1n)
      tx.setExpiration({ Epoch: expirationEpoch })
      const bytes = await bounded(() => tx.build({ client }), 15000, 'COMMUNITY_VOTE_PREPARATION_TIMEOUT_RETRY')
      writable(intent.owner)
      return parsePublicCommunityVoteOperation({ schema: 'soulidity.community-vote-operation.v1', intent,
        bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch, phase: 'PREPARED', signature: null })
    },
  }
}
