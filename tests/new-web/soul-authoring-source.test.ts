import { expect, it, vi } from 'vitest'
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { fromHex, normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import { collectionCommandHash } from '../../web/lib/collections/collection-command-plan'
import { verifySoulAuthoringSources } from '../../web/lib/soulidity/soul-authoring-source'
import { soulAuthoringRequestFixture } from './fixtures/soul-authoring'
import { MAINNET_GENESIS_DIGEST } from '../../web/lib/animacraft/mainnet-chain'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
function fixture(variant = 'valid') {
  const request = soulAuthoringRequestFixture(id(10)), objectId = id(20)
  const type = variant === 'staked' ? normalizeStructTag('0x3::staking_pool::StakedSui') : `${id(21)}::nft::NFT`
  Object.assign(request.mints[0], { kind: 'JOINED', source: { objectId, objectType: type }, originRef: `sui:${objectId}` })
  const tag = TypeTagSerializer.parseFromStr(type)
  if (!('struct' in tag)) throw Error('type')
  const bytes = bcs.Object.serialize({ data: { Move: { type: variant === 'staked' ? { StakedSui: true } : { Other: tag.struct },
    hasPublicTransfer: variant !== 'nontransferable', version: '1', contents: fromHex(objectId) } },
    owner: { AddressOwner: variant === 'owner' ? id(99) : request.author },
    previousTransaction: toBase58(new Uint8Array(32).fill(1)), storageRebate: '0' }).toBytes()
  const row = { objectId: variant === 'id' ? id(99) : objectId, version: 1n,
    digest: variant === 'digest' ? toBase58(new Uint8Array(32).fill(9)) : collectionCommandHash('Object', bytes), bcs: { value: bytes } }
  if (variant === 'type') request.mints[0].source!.objectType = `${id(22)}::other::NFT`
  const get = vi.fn(async () => ({ response: { objects: [{ result: variant === 'missing' ? { oneofKind: 'error', error: { code: 5 } }
    : { oneofKind: 'object', object: row } }] } }))
  const client = { core: { getChainIdentifier: async () => ({ chainIdentifier: variant === 'network' ? 'bad' : MAINNET_GENESIS_DIGEST }) }, ledgerService: { batchGetObjects: get } }
  return { request, get, run: () => verifySoulAuthoringSources(client as any, request, new AbortController().signal) }
}
it.each(['valid', 'staked'])('accepts raw wallet-owned transferable source %s', async variant => {
  await expect(fixture(variant).run()).resolves.toBeUndefined()
})
it.each(['owner', 'nontransferable', 'id', 'digest', 'type', 'missing', 'network'])('rejects %s source before authoring payment', async variant => {
  await expect(fixture(variant).run()).rejects.toThrow()
})
it('does not add source reads to ordinary creation', async () => {
  const f = fixture(); f.request.mints[0].kind = 'ORDINARY'; f.request.mints[0].source = null
  await f.run(); expect(f.get).not.toHaveBeenCalled()
})
