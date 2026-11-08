import { vi } from 'vitest'
import { toBase58 } from '@mysten/sui/utils'
import { blobIdFromInt } from '../../../web/node_modules/@mysten/walrus/dist/index.mjs'
import { contentAppendPreparationFixture, contentAppendFixtureId as id } from './content-append-preparation'
import { deriveNativeCreationContentId } from '../../../web/lib/soulidity/native-creation-transaction'
import { prepareNativeAuthoring, type NativeAuthoringPreparation, type NativeAuthoringRequest, type NativeAuthoringStore } from '../../../web/lib/soulidity/native-authoring-preparation'
import { walrusBatchHash } from '../../../web/lib/upload/walrus-batch-preparation'

export async function nativeAuthoringFixture() {
  const f = await contentAppendPreparationFixture(), author = f.signer.toSuiAddress(), mintNonce = '09'.repeat(16)
  const target = { nativeOriginalPackageId: id(1), nativeCallablePackageId: id(10), custodyCallablePackageId: id(20),
    registryId: id(30), configId: id(31), kindRegistryId: id(32), soulTransferPolicyId: id(33), walrusSystemId: id(34),
    paymentCoinType: `${id(2)}::sui::SUI` }
  const request: NativeAuthoringRequest = { schema: 'soulidity.native-authoring-request.v1', target,
    release: { chainIdentifier: '35834a8a', nativeCallableDigest: toBase58(new Uint8Array(32).fill(1)),
      custodyCallableDigest: toBase58(new Uint8Array(32).fill(2)), blobBaseUrl: 'https://aggregator.example.com' },
    author, operationId: '01'.repeat(16), mintNonce, contentId: deriveNativeCreationContentId(target, author, mintNonce),
    storageEpochs: 5, account: { kind: 'NEW' }, name: 'Canonical Soul', description: 'Durable native preparation', royaltyBps: 250,
    image: { kind: 'URL', url: 'https://images.example.com/soul.png' }, configuration: [],
    slots: [0, 1].map(kind => ({ fileIndex: kind, kind, name: kind ? 'default' : 'soul', nonce: '02'.repeat(16),
      readMask: '3', downloadPolicy: 0, setActive: false })) }
  let saved: NativeAuthoringPreparation | null = null, locked = false
  const store: NativeAuthoringStore = {
    exclusive: async (_key, work) => { if (locked) throw Error('BUSY'); locked = true; try { return await work() } finally { locked = false } },
    read: vi.fn(async () => structuredClone(saved)),
    create: vi.fn(async (_key, p) => { if (saved) throw Error('EXISTS'); saved = structuredClone(p) }),
  }
  const client = { reset: vi.fn(), systemState: vi.fn(async () => ({ committee: { epoch: 10, n_shards: 4 } })),
    encodeBlob: vi.fn(async (bytes: Uint8Array) => ({ blobId: blobIdFromInt(BigInt(`0x${walrusBatchHash(bytes)}`)),
      rootHash: new Uint8Array(32).fill(6), metadata: { V1: { unencoded_length: String(bytes.length), encoding_type: 'RS2' } } })) }
  const params: Parameters<typeof prepareNativeAuthoring>[0] = { request, store, client: client as any,
    files: ['soul', 'memory'].map(name => ({ file: new File([f.params.plaintext], `${name}.md`, { type: 'text/markdown' }),
      kind: 'soul-content', uploadType: 'encrypted' })),
    lifetime: { signal: f.controller.signal, getAddress: f.params.wallet.getAddress, isCurrent: () => true },
    wallet: f.params.wallet, sealConfig: f.params.sealConfig, recoveryNonce: '03'.repeat(16) }
  return { ...f, params, request, store, client, saved: () => saved, setSaved: (p: NativeAuthoringPreparation) => { saved = p },
    prepare: () => prepareNativeAuthoring(params) }
}
