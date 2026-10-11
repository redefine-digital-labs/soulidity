import { vi } from 'vitest'
import { fromHex, toBase58 } from '@mysten/sui/utils'
import { blobIdFromInt } from '../../../web/node_modules/@mysten/walrus/dist/index.mjs'
import { deriveMintContentObjectId, SOUL_PUBLIC_USDC_TYPE } from '../../../packages/soulidity-sdk/src/index'
import { soulAuthoringSealContext, soulAuthoringUploadScope, type SoulAuthoringRequest, type SoulAuthoringManifest } from '../../../web/lib/soulidity/soul-authoring-manifest'
import { prepareWalrusBatch, walrusBatchHash, walrusBatchPreparationHash } from '../../../web/lib/upload/walrus-batch-preparation'
import { createWalrusBatchSealProtector } from '../../../web/lib/upload/walrus-batch-seal'
import { contentAppendPreparationFixture, contentAppendFixtureId as id } from './content-append-preparation'

export function soulAuthoringRequestFixture(author: string): SoulAuthoringRequest {
  const mintNonce = '4'.repeat(32)
  const target = { chainIdentifier: '35834a8a', originalPackageId: id(1), callablePackageId: id(10),
    callableDigest: toBase58(new Uint8Array(32).fill(7)), marketConfigId: id(11), kioskRegistryId: id(12),
    personalKioskTypePackageId: id(13), paymentCoinType: SOUL_PUBLIC_USDC_TYPE, collectionTransferPolicyId: id(14),
    kioskPackageId: id(15), kindRegistryId: id(16), soulTransferPolicyId: id(17), blobBaseUrl: 'https://aggregator.example.com' }
  return { schema: 'soulidity.soul-authoring-request.v1', target, author, operationId: '1'.repeat(32), storageEpochs: 5,
    collection: null, bindCollectionId: null, mints: [{ kind: 'ORDINARY', mintNonce,
      contentObjectId: deriveMintContentObjectId({ ...target, author, mintNonce: fromHex(mintNonce) }), name: 'First Soul',
      description: 'Its original description.', creatorRoyaltyBps: 100, image: { kind: 'URL', url: 'https://images.example.com/soul.png' },
      originRef: null, source: null, slots: [{ fileIndex: 0, kind: 0, name: 'soul', versionIndex: '0', readModeMask: 3, downloadPolicy: 'public', setActive: false },
        { fileIndex: 1, kind: 1, name: 'default', versionIndex: '0', readModeMask: 3, downloadPolicy: 'public', setActive: false }],
      publicPreview: { tags: ['hello'], previewImages: [] }, stateConfig: [], listingPriceAtomic: null }] }
}
export async function soulAuthoringManifestFixture(modify?: (r: SoulAuthoringRequest) => void) {
  const f = await contentAppendPreparationFixture(), r = soulAuthoringRequestFixture(f.signer.toSuiAddress()); modify?.(r)
  const scope = soulAuthoringUploadScope(r), context = r.mints.length ? soulAuthoringSealContext(r, f.params.sealConfig, '3'.repeat(32)) : null
  const lifetime = { signal: f.controller.signal, getAddress: f.params.wallet.getAddress, isCurrent: () => true }
  const crypto = context ? createWalrusBatchSealProtector({ context, wallet: f.params.wallet, lifetime }) : null
  const client = { reset: vi.fn(), systemState: vi.fn(async () => ({ committee: { epoch: 10, n_shards: 4 } })),
    encodeBlob: vi.fn(async (bytes: Uint8Array) => ({ blobId: blobIdFromInt(BigInt(`0x${walrusBatchHash(bytes)}`)), rootHash: new Uint8Array(32).fill(6),
      metadata: { V1: { unencoded_length: String(bytes.length), encoding_type: 'RS2' } } })) }
  const files = r.mints.length ? r.mints.flatMap(mint => mint.slots.map((slot, i) => ({ file: new File([f.params.plaintext], `content-${i}.md`, { type: 'text/markdown' }),
    kind: 'soul-content' as const, uploadType: 'encrypted' as const })))
    : r.collection?.image.kind === 'FILE'
      ? [{ file: new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'cover.png', { type: 'image/png' }), kind: 'soul-content' as const, uploadType: 'public' as const }]
      : []
  const p = await prepareWalrusBatch({ scope, files, client: client as any, lifetime, protector: crypto?.protector ?? null, storageEpochs: r.storageEpochs })
  const manifest: SoulAuthoringManifest = { schema: 'soulidity.soul-authoring-manifest.v1', request: r,
    preparationHash: walrusBatchPreparationHash(p), sealContext: context, sidecars: crypto?.sidecars(p.manifestHash) ?? [] }
  return { ...f, request: r, preparation: p, manifest, walrus: client }
}

