import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase58, fromBase64, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { assertPublicCommunityDeployment, buildCreatePublicCommunityPostTx, buildCreatePublicCommunityCommentTx,
  profileReadStep, createPublicCommunityPublishIntent, validatePublicCommunityUploadReceipt,
  parsePublicCommunityPublishOperation, publicCommunityPublishOperationKey,
  type PublicCommunityPublishIntent, type PublicCommunityUploadReceipt, type PublicCommunityPublishOperation,
  type PublicCommunityPublishOperationAdapter, type PublicCommunityPublishOperationStore } from '@soulidity/sdk'
import type { BrowserCommunityReadConfig } from './public-post-read'
import { assertCommunityPublicationReady } from './publication-preflight'

function check(value: unknown, code: string): asserts value { if (!value) throw new Error(code) }
const timeout = () => AbortSignal.timeout(15000)
const MAX_U64 = 18446744073709551615n
// Full intent document (up to 1 MiB encoded, with JSON escaping), plus bounded
// PTB/signature and release/receipt metadata. Match the upload journal envelope.
const MAX_RECORD = 2 * 1024 * 1024 + 131072
async function bounded<T>(run: () => Promise<T>, milliseconds: number, code: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(code)), milliseconds)
  try { return await profileReadStep(controller.signal, run) }
  finally { clearTimeout(timer) }
}

/** Synchronous storage screening is deliberately nonauthorizing. The runner and
 * every adapter entry await the SDK's cryptographic receipt/PTB parser. */
function storageRecord(key: string, input: unknown): PublicCommunityPublishOperation {
  const record = structuredClone(input) as PublicCommunityPublishOperation
  const fields = ['schema', 'intent', 'receipt', 'bytes', 'digest', 'expirationEpoch', 'phase', 'signature']
  check(record && typeof record === 'object' && !Array.isArray(record)
    && Object.keys(record).length === fields.length && fields.every(field => Object.hasOwn(record, field))
    && record.schema === 'soulidity.community-publish-operation.v1', 'COMMUNITY_PUBLISH_RECOVERY_RECORD_INVALID')
  check(publicCommunityPublishOperationKey(record.intent) === key, 'COMMUNITY_PUBLISH_OPERATION_SCOPE_MISMATCH')
  check(JSON.stringify(record).length <= MAX_RECORD, 'COMMUNITY_PUBLISH_RECOVERY_RECORD_TOO_LARGE')
  return record
}
export function browserPublicCommunityPublishOperationStore(): PublicCommunityPublishOperationStore {
  check(typeof window !== 'undefined' && navigator.locks?.request, 'COMMUNITY_PUBLISH_RECOVERY_REQUIRES_STORAGE_AND_LOCKS')
  const storage = window.localStorage
  return {
    exclusive: (key, work) => navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
      check(lock, 'COMMUNITY_PUBLISH_OPERATION_BUSY_IN_ANOTHER_TAB'); return work()
    }),
    read: key => {
      const raw = storage.getItem(key)
      if (raw === null) return null
      check(raw.length <= MAX_RECORD, 'COMMUNITY_PUBLISH_RECOVERY_RECORD_TOO_LARGE')
      return storageRecord(key, JSON.parse(raw))
    },
    write: (key, input) => {
      const encoded = JSON.stringify(storageRecord(key, input))
      storage.setItem(key, encoded)
      check(storage.getItem(key) === encoded, 'COMMUNITY_PUBLISH_RECOVERY_PERSISTENCE_FAILED')
    },
  }
}

export function createPublicCommunityPublishOperationClient(params: {
  client: SuiGrpcClient; config: BrowserCommunityReadConfig
  writesEnabled: () => boolean; getAddress: () => string | null
  sign: (transaction: Transaction) => Promise<{ bytes: string; signature: string }>
}): { prepare: (intent: PublicCommunityPublishIntent, receipt: PublicCommunityUploadReceipt) => Promise<PublicCommunityPublishOperation>
  adapter: PublicCommunityPublishOperationAdapter } {
  const config = structuredClone(params.config)
  config.deployment = assertPublicCommunityDeployment(config.deployment)
  const deployment = config.deployment
  const { client, writesEnabled, getAddress, sign } = params
  function scope(intent: PublicCommunityPublishIntent) {
    const expected = createPublicCommunityPublishIntent({ ...intent, deployment })
    check(publicCommunityPublishOperationKey(intent) === publicCommunityPublishOperationKey(expected)
      && JSON.stringify(intent.deployment) === JSON.stringify(expected.deployment), 'COMMUNITY_PUBLISH_RELEASE_CHANGED')
  }
  function writable(owner: string) {
    check(writesEnabled(), 'COMMUNITY_PUBLISH_WRITES_DISABLED')
    check(getAddress() === owner, 'COMMUNITY_PUBLISH_RECONNECT_PREPARING_WALLET')
  }
  async function chain() {
    const { chainIdentifier } = await profileReadStep(timeout(), () => client.core.getChainIdentifier())
    const digest = fromBase58(chainIdentifier)
    check(digest.length === 32 && toBase58(digest) === chainIdentifier
      && toHex(digest.subarray(0, 4)) === deployment.profile.chainIdentifier, 'COMMUNITY_PUBLISH_WRONG_CHAIN')
  }
  async function epoch() {
    const { response } = await profileReadStep(timeout(), () => client.ledgerService.getEpoch({ readMask: { paths: ['epoch'] } }))
    check(typeof response.epoch?.epoch === 'bigint' && response.epoch.epoch >= 0n && response.epoch.epoch < MAX_U64,
      'COMMUNITY_PUBLISH_CURRENT_EPOCH_UNAVAILABLE')
    return response.epoch.epoch
  }
  async function ready(intent: PublicCommunityPublishIntent, receipt: PublicCommunityUploadReceipt) {
    const signal = AbortSignal.timeout(40000)
    await profileReadStep(signal, () => assertCommunityPublicationReady({ client, config, intent, receipt, signal }))
  }
  const adapter: PublicCommunityPublishOperationAdapter = {
    async preflight(input, _signing) {
      const record = await parsePublicCommunityPublishOperation(input)
      scope(record.intent); writable(record.intent.owner); await chain()
      await ready(record.intent, record.receipt)
      check(await epoch() <= BigInt(record.expirationEpoch), 'COMMUNITY_PUBLISH_TRANSACTION_EXPIRED_QUERY_ONLY')
      writable(record.intent.owner)
    },
    async sign(input) {
      const record = await parsePublicCommunityPublishOperation(input)
      check(record.phase === 'PREPARED' || record.phase === 'SIGNING', 'COMMUNITY_PUBLISH_OPERATION_NOT_SIGNABLE')
      scope(record.intent); writable(record.intent.owner)
      return bounded(() => sign(Transaction.from(fromBase64(record.bytes))), 120000, 'COMMUNITY_PUBLISH_SIGNING_TIMEOUT_QUERY_SAVED_TRANSACTION')
    },
    async verifySignature(input) {
      const record = await parsePublicCommunityPublishOperation(input)
      scope(record.intent); check(record.signature, 'COMMUNITY_PUBLISH_SIGNATURE_REQUIRED')
      await bounded(() => verifyTransactionSignature(fromBase64(record.bytes), record.signature!, { address: record.intent.owner, client }),
        15000, 'COMMUNITY_PUBLISH_SIGNATURE_CHECK_TIMEOUT_QUERY_SAVED_TRANSACTION')
    },
    async broadcast(input) {
      const record = await parsePublicCommunityPublishOperation(input)
      scope(record.intent); writable(record.intent.owner)
      check(record.phase === 'SIGNED' && record.signature, 'COMMUNITY_PUBLISH_SIGNATURE_REQUIRED')
      await bounded(() => client.core.executeTransaction({ transaction: fromBase64(record.bytes), signatures: [record.signature!] }),
        30000, 'COMMUNITY_PUBLISH_BROADCAST_TIMEOUT_QUERY_SAVED_TRANSACTION')
    },
    async query(input) {
      const record = await parsePublicCommunityPublishOperation(input)
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
      'COMMUNITY_PUBLISH_TRANSACTION_EVIDENCE_MISMATCH')
      const bytes = value.effects.bcs.value, decoded = bcs.TransactionEffects.parse(bytes)
      check(toBase64(bcs.TransactionEffects.serialize(decoded).toBytes()) === toBase64(bytes), 'COMMUNITY_PUBLISH_EFFECTS_NONCANONICAL')
      const effects = decoded.V2 ?? decoded.V1
      check(effects?.transactionDigest === record.digest && ['Success', 'Failure'].includes(effects.status.$kind)
        && value.effects.status?.success === (effects.status.$kind === 'Success')
        && BigInt(effects.executedEpoch) <= BigInt(record.expirationEpoch), 'COMMUNITY_PUBLISH_TRANSACTION_STATUS_MISMATCH')
      if (value.checkpoint === undefined) return 'PENDING'
      check(typeof value.checkpoint === 'bigint' && value.checkpoint >= 0n && value.checkpoint <= MAX_U64, 'COMMUNITY_PUBLISH_CHECKPOINT_INVALID')
      return effects.status.$kind === 'Success' ? 'SUCCEEDED' : 'FAILED'
    },
  }
  return {
    adapter,
    async prepare(input, uploaded) {
      const intent = createPublicCommunityPublishIntent(input)
      const receipt = await validatePublicCommunityUploadReceipt(intent, uploaded)
      scope(intent); writable(intent.owner); await chain(); await ready(intent, receipt)
      const tx = intent.kind === 'post'
        ? buildCreatePublicCommunityPostTx({ ...intent, document: receipt.reference,
          postType: (['log', 'question', 'knowledge'] as const)[intent.postType], channel: intent.channel === 0 ? 'general' : 'questions' })
        : buildCreatePublicCommunityCommentTx({ ...intent, document: receipt.reference })
      const expirationEpoch = String(await epoch() + 1n)
      tx.setExpiration({ Epoch: expirationEpoch })
      const bytes = await bounded(() => tx.build({ client }), 15000, 'COMMUNITY_PUBLISH_PREPARATION_TIMEOUT_RETRY')
      writable(intent.owner)
      return parsePublicCommunityPublishOperation({ schema: 'soulidity.community-publish-operation.v1', intent, receipt,
        bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch, phase: 'PREPARED', signature: null })
    },
  }
}
