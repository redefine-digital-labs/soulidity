import { vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { ClientCache } from '@mysten/sui/client'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fromBase64, toBase58 } from '@mysten/sui/utils'
import { WalrusClient, blobIdFromInt } from '../../../web/node_modules/@mysten/walrus/dist/index.mjs'
import { sha256Hex } from '../../../web/lib/upload/client-seal'
import { uploadDurableWalrusBlob, recoverDurableWalrusBlob } from '../../../web/lib/upload/walrus-single-upload'
import { walrusSingleKey, type WalrusSingleAttachment } from '../../../web/lib/upload/walrus-single-operation'

// Real pinned Walrus flow/register/certify graph and Sui serialization/signature.
// WASM encoding, storage-node certificate and chain responses are controlled
// boundaries, not actual Walrus BLS quorum or chain execution evidence.
export const uid = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
export const singleSigner = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(44))
const referenceDigest = toBase58(new Uint8Array(32).fill(5))
const Blob = bcs.struct('Blob', { id: bcs.Address, registered_epoch: bcs.u32(), blob_id: bcs.u256(), size: bcs.u64(),
  encoding_type: bcs.u8(), certified_epoch: bcs.option(bcs.u32()), storage: bcs.struct('Storage', {
    id: bcs.Address, start_epoch: bcs.u32(), end_epoch: bcs.u32(), storage_size: bcs.u64(),
  }), deletable: bcs.bool() })
export async function singleUploadFixture(attachment: WalrusSingleAttachment | null = null, relay = false, source: {
  signer?: Ed25519Keypair; payload?: Uint8Array; contentHash?: string; operationScope?: string; relayUrl?: string
} = {}) {
  const signer = source.signer ?? singleSigner
  const owner = signer.toSuiAddress(), blobObjectId = uid(101), blobId = blobIdFromInt(1n)
  const payload = new Uint8Array(source.payload ?? new TextEncoder().encode('{"name":"Public profile"}'))
  const intent = { network: 'mainnet' as const, owner, recipient: owner, operationScope: source.operationScope ?? 'profile:metadata:original-intent',
    attachmentScope: attachment?.scope ?? null, contentHash: source.contentHash ?? await sha256Hex(payload), payloadHash: await sha256Hex(payload),
    payloadByteLength: payload.length, storageEpochs: 3, relayUrl: source.relayUrl ?? 'https://upload-relay.mainnet.walrus.space' }
  const key = walrusSingleKey(intent), records = new Map<string, { bytes: Uint8Array; effects: Uint8Array; register: boolean }>()
  let certified = false, storageEnd = 12, currentOwner: string | null = owner
  let registerOwner = owner
  const blob = () => ({ id: blobObjectId, registered_epoch: 9, blob_id: '1', size: String(payload.length), encoding_type: 1,
    certified_epoch: certified ? 9 : null, storage: { id: uid(102), start_epoch: 9, end_epoch: storageEnd, storage_size: '1000' }, deletable: true })
  const cache = new ClientCache()
  cache.scope('@mysten/walrus').readSync(['getSystemPackageId'], () => uid(3))
  cache.scope('@mysten/walrus').readSync(['getBlobType'], () => `${uid(3)}::blob::Blob`)
  cache.scope('@mysten/walrus').readSync(['walType'], () => `${uid(4)}::wal::WAL`)
  const client = {
    cache,
    core: {
      getChainIdentifier: vi.fn(async () => ({ chainIdentifier: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S' })),
      getBalance: vi.fn(async () => ({ balance: { balance: '1000000000', coinBalance: '1000000000', addressBalance: '0' } })),
      listCoins: vi.fn(async () => ({ objects: [{ objectId: uid(88), version: '1', digest: referenceDigest, balance: '1000000000' }], hasNextPage: false, cursor: null })),
      resolveTransactionPlugin: () => async (data: any, _options: unknown, next: () => Promise<void>) => {
        data.inputs = data.inputs.map((input: any) => {
          if (!input.UnresolvedObject) return input
          const objectId = input.UnresolvedObject.objectId
          return objectId === blobObjectId ? Inputs.ObjectRef({ objectId, version: certified ? '3' : '2', digest: referenceDigest })
            : Inputs.SharedObjectRef({ objectId, initialSharedVersion: '1', mutable: true })
        })
        data.gasData = { owner, budget: data.gasData.budget ?? '50000000', price: '1000',
          payment: [{ objectId: uid(90), version: '1', digest: referenceDigest }] }
        await next()
      },
      executeTransaction: vi.fn(async ({ transaction: bytes }: { transaction: Uint8Array }) => {
        const data = Transaction.from(bytes).getData(), digest = TransactionDataBuilder.getDigestFromBytes(bytes)
        const register = data.commands.some(command => command.MoveCall?.function === 'register_blob')
        if (!register) certified = true
        const effects = bcs.TransactionEffects.serialize({ V2: {
          status: { Success: true }, executedEpoch: '9', gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' },
          transactionDigest: digest, gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: register ? '2' : '3',
          changedObjects: [[blobObjectId, { inputState: register ? { NotExist: true } : { Exist: [['2', referenceDigest], { AddressOwner: owner }] },
            outputState: { ObjectWrite: [referenceDigest, { AddressOwner: registerOwner }] }, idOperation: register ? { Created: true } : { None: true } }]],
          unchangedConsensusObjects: [], auxDataDigest: null,
        } }).toBytes()
        records.set(digest, { bytes, effects, register }); return {}
      }),
      getObject: vi.fn(async ({ objectId }: { objectId: string }) => ({ object: { objectId,
        type: `${uid(3)}::blob::Blob`, content: Blob.serialize(blob()).toBytes(), owner: { AddressOwner: owner } } })),
      waitForTransaction: vi.fn(async ({ digest }: { digest: string }) => ({ Transaction: { digest,
        effects: { changedObjects: [{ objectId: blobObjectId, idOperation: 'Created' }] } } })),
      getObjects: vi.fn(async () => ({ objects: [{ objectId: blobObjectId, type: `${uid(3)}::blob::Blob`, content: Blob.serialize(blob()).toBytes() }] })),
      getTransaction: vi.fn(async ({ digest }: { digest: string }) => {
        if (!records.has(digest)) throw new Error('No transaction')
        return { Transaction: { digest, effects: { transactionDigest: digest, status: { success: true }, changedObjects: [] },
          events: [{ packageId: uid(3), module: 'test', sender: owner, eventType: `${uid(3)}::test::Receipt`, bcs: new Uint8Array([1]) }] } }
      }),
    },
    ledgerService: {
      getEpoch: vi.fn(async () => ({ response: { epoch: { epoch: 9n } } })),
      getTransaction: vi.fn(async ({ digest }: { digest: string }) => {
        const row = records.get(digest); if (!row) throw { code: 'NOT_FOUND' }
        return { response: { transaction: { digest, transaction: { digest, bcs: { value: row.bytes } },
          effects: { status: { success: true }, bcs: { value: row.effects } }, checkpoint: 1n } } }
      }),
    },
  }
  const walrus = new WalrusClient({ suiClient: client as any, network: 'mainnet',
    ...(relay ? { uploadRelay: { host: 'https://upload-relay.mainnet.walrus.space', sendTip: { max: 1 } } } : {}) })
  if (relay) cache.scope('@mysten/walrus').readSync(['upload-relay-tip-config'], () => ({ address: uid(200), kind: { const: 1n }, max: 1 }))
  vi.spyOn(walrus, 'systemObject').mockResolvedValue({ id: uid(50), package_id: uid(3) } as any)
  vi.spyOn(walrus, 'systemState').mockResolvedValue({ committee: { epoch: 9, n_shards: 1, members: [{ weight: 1 }] }, storage_price_per_unit_size: '1', write_price_per_unit_size: '1' } as any)
  vi.spyOn(walrus, 'storageCost').mockResolvedValue({ storageCost: 3n, writeCost: 2n, totalCost: 5n })
  vi.spyOn(walrus, 'encodeBlob').mockResolvedValue({ blobId, rootHash: new Uint8Array(32).fill(2), metadata: {} as any, sliversByNode: [] } as any)
  const metadata = vi.spyOn(walrus, 'computeBlobMetadata').mockImplementation(async ({ nonce }) => ({ blobId,
    rootHash: new Uint8Array(32).fill(2), nonce: nonce ?? new Uint8Array(32).fill(7), blobDigest: new Uint8Array(32).fill(8),
    metadata: { encodingType: 1 } } as any))
  const relayWrite = vi.spyOn(walrus, 'writeBlobToUploadRelay').mockResolvedValue({
    certificate: { signers: [0], serializedMessage: new Uint8Array([1]), signature: new Uint8Array(48).fill(2) },
  } as any)
  vi.spyOn(walrus, 'getBlobObject').mockImplementation(async () => blob() as any)
  const write = vi.spyOn(walrus, 'writeEncodedBlobToNodes').mockResolvedValue([{ node: 0 }] as any)
  vi.spyOn(walrus, 'certificateFromConfirmations').mockResolvedValue({ signers: [0], serializedMessage: new Uint8Array([1]), signature: new Uint8Array(48).fill(2) })
  const read = vi.spyOn(walrus, 'readBlob').mockImplementation(async () => new Uint8Array(payload))
  const sign = vi.fn(async (tx: Transaction) => signer.signTransaction(await tx.build()))
  const execution = { client: client as any, getAddress: () => currentOwner, sign }
  const approve = vi.fn(async () => ({ relayTip: '1', storageCost: '3', writeCost: '2', gasBudget: '100000000', quoteId: 'quote' }))
  const params = { intent, payload, execution, attachment, createClient: async () => walrus, approve }
  return { ...params, key, client, walrus, sign, read, write, metadata, relayWrite, records, blobId, blobObjectId,
    run: () => uploadDurableWalrusBlob(params),
    recover: () => recoverDurableWalrusBlob({ key, operationScope: intent.operationScope, execution, attachment, createClient: params.createClient }),
    setOwner: (value: string | null) => { currentOwner = value }, setStorageEnd: (value: number) => { storageEnd = value },
    setRegisterOwner: (value: string) => { registerOwner = value } }
}
