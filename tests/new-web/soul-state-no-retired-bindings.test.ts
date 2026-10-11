import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => ({ getObject: vi.fn(), getDynamicFields: vi.fn(), getDynamicFieldObject: vi.fn() }))
vi.mock('../../packages/soulidity-sdk/src/sui-client', () => ({ suiClient: rpc }))
import { getSoulStateObject, OnChainVerificationError } from '../../packages/soulidity-sdk/src/queries'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const type = `${id(1)}::soul::SoulState`
const fields = () => ({ soul_id: id(3), creator: id(4), creator_royalty_bps: '250',
  current_owner: id(5), current_kiosk_id: id(6), ownership_epoch: '7', grant_capacity: '10',
  active_grant_count: '0', active_grants: { fields: { id: { id: id(8) } } },
  content_id: { vec: [id(9)] }, access_list_id: { vec: [id(10)] },
  collection_id: { vec: [] }, is_listed: false })
function object(value = fields()) { return { data: { objectId: id(2), type,
  content: { dataType: 'moveObject', type, fields: value } } } }
const slot = (epoch = '7') => ({ grant_id: id(11), grantee: id(12), scope_mask: '15',
  expires_at_ms: { vec: ['123456'] }, ownership_epoch_snapshot: epoch })

describe('ordinary SoulState reads do not consult retired appearance/wardrobe/Profile bindings', () => {
  beforeEach(() => { vi.resetAllMocks(); rpc.getObject.mockResolvedValue(object()) })
  it.each([undefined, { includeActiveGrants: false }, { includeActiveGrants: true }])('does not query any dynamic field for an empty grant table (%j)', async options => {
    rpc.getDynamicFieldObject.mockRejectedValue(new Error('retired endpoint unavailable'))
    const state = await getSoulStateObject(id(2), id(1), options)
    expect(state).toMatchObject({ soulId: id(3), currentOwnerAddress: id(5), ownershipEpoch: 7,
      creatorRoyaltyBps: 250, activeGrants: [], activeGrantCount: 0, contentId: id(9), paidAccessListId: id(10), collectionId: null })
    for (const name of ['animacraftAppearanceV6Id', 'animacraftWardrobeV7Id', 'animacraftPhysicalProfileV7Id']) expect(state).not.toHaveProperty(name)
    expect(rpc.getDynamicFields).not.toHaveBeenCalled()
    expect(rpc.getDynamicFieldObject).not.toHaveBeenCalled()
  })
  it('still reads exact grant table entries and excludes grants from an old ownership epoch', async () => {
    rpc.getObject.mockResolvedValue(object({ ...fields(), active_grant_count: '1' }))
    const old = { type: 'address', value: id(13) }, current = { type: 'address', value: id(12) }
    rpc.getDynamicFields.mockResolvedValue({ data: [{ name: old }, { name: current }], hasNextPage: false })
    rpc.getDynamicFieldObject.mockResolvedValueOnce({ data: { content: { fields: { value: slot('6') } } } })
      .mockResolvedValueOnce({ data: { content: { fields: { value: slot() } } } })
    const state = await getSoulStateObject(id(2), id(1))
    expect(state.activeGrants).toEqual([{ grantId: id(11), granteeAddress: id(12), scopeMask: 15,
      scopes: ['seal', 'memory', 'skills', 'assets'], expiresAtMs: 123456, ownershipEpochSnapshot: 7 }])
    expect(rpc.getDynamicFieldObject.mock.calls).toEqual([[{ parentId: id(8), name: old }], [{ parentId: id(8), name: current }]])
  })
  it('does not materialize nonempty grant tables when explicitly disabled', async () => {
    rpc.getObject.mockResolvedValue(object({ ...fields(), active_grant_count: '2' }))
    expect(await getSoulStateObject(id(2), id(1), { includeActiveGrants: false })).toMatchObject({ activeGrantCount: 2, activeGrants: [], activeGrantsTableId: id(8) })
    expect(rpc.getDynamicFieldObject).not.toHaveBeenCalled()
    expect(rpc.getDynamicFields).not.toHaveBeenCalled()
  })
  it('still propagates state and grant transport failures instead of manufacturing empty state', async () => {
    rpc.getObject.mockRejectedValueOnce(new Error('state timeout'))
    await expect(getSoulStateObject(id(2), id(1))).rejects.toThrow('state timeout')
    rpc.getObject.mockResolvedValue(object({ ...fields(), active_grant_count: '1' }))
    rpc.getDynamicFields.mockRejectedValue(new Error('grant timeout'))
    await expect(getSoulStateObject(id(2), id(1))).rejects.toThrow('grant timeout')
  })
  it('still rejects a wrong package or malformed state', async () => {
    rpc.getObject.mockResolvedValueOnce({ data: { ...object().data, type: `${id(99)}::soul::SoulState` } })
    await expect(getSoulStateObject(id(2), id(1))).rejects.toBeInstanceOf(OnChainVerificationError)
    rpc.getObject.mockResolvedValueOnce(object({ ...fields(), current_owner: 'not an address' }))
    await expect(getSoulStateObject(id(2), id(1))).rejects.toBeInstanceOf(OnChainVerificationError)
  })
})
