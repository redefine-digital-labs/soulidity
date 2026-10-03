import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase58, fromBase64, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { assertWalletProfileDeployment, preparePublicProfileSave, parsePublicProfileOperation, validatePublicProfileOperation, profileReadStep,
  type PreparedPublicProfileSave, type PublicProfileOperation, type PublicProfileOperationAdapter,
  type PublicProfileOperationStore, type PublicProfileStorageTarget, type WalletProfileDeployment } from '@soulidity/sdk'

function check(value: unknown, code: string): asserts value { if (!value) throw new Error(code) }
const timeout = () => AbortSignal.timeout(15000)

export function browserPublicProfileOperationStore(): PublicProfileOperationStore {
  check(typeof window !== 'undefined' && navigator.locks?.request, 'PROFILE_RECOVERY_REQUIRES_STORAGE_AND_LOCKS')
  const storage = window.localStorage
  return {
    exclusive: (key, work) => navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
      check(lock, 'PROFILE_OPERATION_BUSY_IN_ANOTHER_TAB'); return work()
    }),
    read: key => {
      const raw = storage.getItem(key)
      if (raw === null) return null
      check(raw.length <= 65536, 'PROFILE_RECOVERY_RECORD_TOO_LARGE')
      return parsePublicProfileOperation(JSON.parse(raw))
    },
    write: (key, record) => {
      const encoded = JSON.stringify(parsePublicProfileOperation(record))
      check(encoded.length <= 65536, 'PROFILE_RECOVERY_RECORD_TOO_LARGE')
      storage.setItem(key, encoded)
      check(storage.getItem(key) === encoded, 'PROFILE_RECOVERY_PERSISTENCE_FAILED')
    },
  }
}

/** Real browser gRPC + wallet adapter. Local storage is only an operation log;
 * final status comes from exact transaction/effects/checkpoint evidence. */
export function createPublicProfileOperationClient(params: {
  client: SuiGrpcClient; deployment: WalletProfileDeployment; storage: PublicProfileStorageTarget
  writesEnabled: () => boolean
  getAddress: () => string | null
  sign: (transaction: Transaction) => Promise<{ bytes: string; signature: string }>
  fetcher?: typeof fetch
}): { prepare: (save: Extract<PreparedPublicProfileSave, { status: 'prepared' }>) => Promise<PublicProfileOperation>
  adapter: PublicProfileOperationAdapter } {
  const deployment = assertWalletProfileDeployment(params.deployment), storage = structuredClone(params.storage)
  const { client, fetcher, writesEnabled, getAddress, sign } = params
  async function chain() {
    const { chainIdentifier } = await profileReadStep(timeout(), () => client.core.getChainIdentifier())
    const digest = fromBase58(chainIdentifier)
    check(digest.length === 32 && toBase58(digest) === chainIdentifier
      && toHex(digest.subarray(0, 4)) === deployment.chainIdentifier, 'PROFILE_WRONG_CHAIN')
  }
  async function epoch() {
    const { response } = await profileReadStep(timeout(), () => client.ledgerService.getEpoch({ readMask: { paths: ['epoch'] } }))
    check(typeof response.epoch?.epoch === 'bigint' && response.epoch.epoch >= 0n && response.epoch.epoch < 18446744073709551615n,
      'PROFILE_CURRENT_EPOCH_UNAVAILABLE')
    return response.epoch.epoch
  }
  function writable(owner: string) {
    check(writesEnabled(), 'PROFILE_WRITES_DISABLED')
    check(getAddress() === owner, 'PROFILE_RECONNECT_PREPARING_WALLET')
  }
  function scope(record: PublicProfileOperation) {
    check(JSON.stringify(record.intent.deployment) === JSON.stringify(deployment), 'PROFILE_RELEASE_CHANGED')
  }
  const adapter: PublicProfileOperationAdapter = {
    async preflight(input, signing) {
      const record = await validatePublicProfileOperation(input)
      scope(record); writable(record.intent.owner); await chain()
      if (signing) {
        const prepared = await preparePublicProfileSave({ client: client.core, intent: record.intent,
          receipt: record.receipt, storage, fetcher, signal: timeout(),
          upload: async () => { throw new Error('PROFILE_RECOVERY_MUST_NOT_UPLOAD') },
          persistReceipt: async () => { /* receipt is already in the durable operation */ },
        })
        check(prepared.status === 'prepared', 'PROFILE_ALREADY_CURRENT_QUERY_SAVED_TRANSACTION')
      }
      check(await epoch() <= BigInt(record.expirationEpoch), 'PROFILE_TRANSACTION_EXPIRED_QUERY_ONLY')
      writable(record.intent.owner)
    },
    async sign(record) { writable(record.intent.owner); return sign(Transaction.from(fromBase64(record.bytes))) },
    async verifySignature(record) {
      check(record.signature, 'PROFILE_SIGNATURE_REQUIRED')
      await verifyTransactionSignature(fromBase64(record.bytes), record.signature, { address: record.intent.owner, client })
    },
    async broadcast(record) {
      scope(record); writable(record.intent.owner); check(record.signature, 'PROFILE_SIGNATURE_REQUIRED')
      // This call is intentionally not abort-raced. The durable signed record
      // survives any transport result, and recovery always queries its digest.
      await client.core.executeTransaction({ transaction: fromBase64(record.bytes), signatures: [record.signature] })
    },
    async query(record) {
      scope(record); await chain()
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
      'PROFILE_TRANSACTION_EVIDENCE_MISMATCH')
      const bytes = value.effects.bcs.value, decoded = bcs.TransactionEffects.parse(bytes)
      check(toBase64(bcs.TransactionEffects.serialize(decoded).toBytes()) === toBase64(bytes), 'PROFILE_EFFECTS_NONCANONICAL')
      const effects = decoded.V2 ?? decoded.V1
      check(effects?.transactionDigest === record.digest && ['Success', 'Failure'].includes(effects.status.$kind)
        && value.effects.status?.success === (effects.status.$kind === 'Success'), 'PROFILE_TRANSACTION_STATUS_MISMATCH')
      if (value.checkpoint === undefined) return 'PENDING'
      check(value.checkpoint >= 0n, 'PROFILE_CHECKPOINT_INVALID')
      return effects.status.$kind === 'Success' ? 'SUCCEEDED' : 'FAILED'
    },
  }
  return {
    adapter,
    async prepare(save) {
      const intent = structuredClone(save.intent), receipt = structuredClone(save.receipt)
      const tx = Transaction.from(JSON.stringify(save.transaction.getData()))
      check(JSON.stringify(intent.deployment) === JSON.stringify(deployment), 'PROFILE_RELEASE_CHANGED')
      writable(intent.owner); await chain()
      const expirationEpoch = String(await epoch() + 1n)
      tx.setSender(intent.owner); tx.setExpiration({ Epoch: expirationEpoch })
      const bytes = await tx.build({ client })
      writable(intent.owner)
      return validatePublicProfileOperation({ schema: 'soulidity.public-profile-operation.v1', intent, receipt,
        bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch, phase: 'PREPARED', signature: null })
    },
  }
}
