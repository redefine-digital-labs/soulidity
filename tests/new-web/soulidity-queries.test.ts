import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedGetObject = vi.hoisted(() => vi.fn())
const mockedGetOwnedObjects = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/sui', () => ({
  suiClient: {
    getObject: mockedGetObject,
    getOwnedObjects: mockedGetOwnedObjects,
  },
}))

describe('Soulidity queries', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID = '0x' + '99'.repeat(32)
  })

  it('parses SoulSkills objects without depending on legacy version_ids vectors', async () => {
    mockedGetObject.mockResolvedValue({
      data: {
        objectId: '0x5',
        type: '0x42::skills::SoulSkills',
        content: {
          dataType: 'moveObject',
          type: '0x42::skills::SoulSkills',
          fields: {
            soul_id: '0x6',
            skill_count: '2',
            skills: {
              type: '0x2::table::Table<0x1::string::String, vector<0x42::skills::SkillSlot>>',
              fields: {
                id: { id: '0x8' },
                size: '2',
              },
            },
          },
        },
      },
    })

    const { getSoulSkillsObject } = await import('../../new-web/lib/soulidity/queries')
    await expect(getSoulSkillsObject('0x5', '0x42')).resolves.toEqual({
      objectId: '0x5',
      packageId: '0x0000000000000000000000000000000000000000000000000000000000000042',
      soulId: '0x0000000000000000000000000000000000000000000000000000000000000006',
      skillCount: 2,
      skillsTableId: '0x0000000000000000000000000000000000000000000000000000000000000008',
    })
  })

  it('pages through owned personal kiosk caps and returns every valid kiosk cap state', async () => {
    mockedGetOwnedObjects
      .mockResolvedValueOnce({
        data: [{
          data: {
            objectId: '0x1',
            type: `${'0x' + '99'.repeat(32)}::personal_kiosk::PersonalKioskCap`,
            owner: { AddressOwner: '0xabc' },
            content: {
              dataType: 'moveObject',
              type: `${'0x' + '99'.repeat(32)}::personal_kiosk::PersonalKioskCap`,
              fields: {
                cap: {
                  fields: {
                    for: '0x11',
                  },
                },
              },
            },
          },
        }],
        hasNextPage: true,
        nextCursor: 'cursor-2',
      })
      .mockResolvedValueOnce({
        data: [{
          data: {
            objectId: '0x2',
            type: `${'0x' + '99'.repeat(32)}::personal_kiosk::PersonalKioskCap`,
            owner: { AddressOwner: '0xabc' },
            content: {
              dataType: 'moveObject',
              type: `${'0x' + '99'.repeat(32)}::personal_kiosk::PersonalKioskCap`,
              fields: {
                cap: {
                  fields: {
                    for: '0x22',
                  },
                },
              },
            },
          },
        }],
        hasNextPage: false,
        nextCursor: null,
      })

    const { listOwnedPersonalKioskCaps } = await import('../../new-web/lib/soulidity/queries')

    await expect(listOwnedPersonalKioskCaps('0xabc')).resolves.toEqual([
      {
        ownerAddress: '0x0000000000000000000000000000000000000000000000000000000000000abc',
        currentKioskId: '0x0000000000000000000000000000000000000000000000000000000000000011',
        currentKioskCapOnChainId: '0x0000000000000000000000000000000000000000000000000000000000000001',
      },
      {
        ownerAddress: '0x0000000000000000000000000000000000000000000000000000000000000abc',
        currentKioskId: '0x0000000000000000000000000000000000000000000000000000000000000022',
        currentKioskCapOnChainId: '0x0000000000000000000000000000000000000000000000000000000000000002',
      },
    ])

    expect(mockedGetOwnedObjects).toHaveBeenNthCalledWith(1, {
      owner: '0xabc',
      filter: { StructType: `${'0x' + '99'.repeat(32)}::personal_kiosk::PersonalKioskCap` },
      options: {
        showOwner: true,
        showContent: true,
        showType: true,
      },
    })
    expect(mockedGetOwnedObjects).toHaveBeenNthCalledWith(2, {
      owner: '0xabc',
      cursor: 'cursor-2',
      filter: { StructType: `${'0x' + '99'.repeat(32)}::personal_kiosk::PersonalKioskCap` },
      options: {
        showOwner: true,
        showContent: true,
        showType: true,
      },
    })
  })
})
