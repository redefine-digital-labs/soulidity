import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OFFICIAL_MAINNET_KIOSK_PACKAGE_ID,
  OFFICIAL_MAINNET_KIOSK_TYPE_PACKAGE_ID,
} from '../../web/lib/soulidity/kiosk'

const mockedGetObject = vi.hoisted(() => vi.fn())
const mockedGetOwnedObjects = vi.hoisted(() => vi.fn())
const mockedGetDynamicFieldObject = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/sui', () => ({
  suiClient: {
    getObject: mockedGetObject,
    getOwnedObjects: mockedGetOwnedObjects,
    getDynamicFieldObject: mockedGetDynamicFieldObject,
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

    const { getSoulSkillsObject } = await import('../../web/lib/soulidity/queries')
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

    const { listOwnedPersonalKioskCaps } = await import('../../web/lib/soulidity/queries')

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

  it('uses the official mainnet kiosk type origin when listing upgraded PersonalKioskCap objects', async () => {
    process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID = OFFICIAL_MAINNET_KIOSK_PACKAGE_ID
    mockedGetOwnedObjects.mockResolvedValueOnce({
      data: [{
        data: {
          objectId: '0x1',
          type: `${OFFICIAL_MAINNET_KIOSK_TYPE_PACKAGE_ID}::personal_kiosk::PersonalKioskCap`,
          owner: { AddressOwner: '0xabc' },
          content: {
            dataType: 'moveObject',
            type: `${OFFICIAL_MAINNET_KIOSK_TYPE_PACKAGE_ID}::personal_kiosk::PersonalKioskCap`,
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
      hasNextPage: false,
      nextCursor: null,
    })

    const { listOwnedPersonalKioskCaps } = await import('../../web/lib/soulidity/queries')

    await expect(listOwnedPersonalKioskCaps('0xabc')).resolves.toHaveLength(1)
    expect(mockedGetOwnedObjects).toHaveBeenCalledWith({
      owner: '0xabc',
      filter: {
        StructType: `${OFFICIAL_MAINNET_KIOSK_TYPE_PACKAGE_ID}::personal_kiosk::PersonalKioskCap`,
      },
      options: {
        showOwner: true,
        showContent: true,
        showType: true,
      },
    })
  })

  it('parses SoulMetadata active sprite returned as a direct struct', async () => {
    mockedGetObject.mockResolvedValue({
      data: {
        objectId: '0x5',
        type: '0x42::metadata::SoulMetadata',
        content: {
          dataType: 'moveObject',
          type: '0x42::metadata::SoulMetadata',
          fields: {
            soul_id: '0x6',
            active_sprite: {
              asset_name: 'persona-sprite',
              version_index: '1',
              download_policy: 0,
            },
            active_voice: null,
            ext: {
              fields: {
                id: { id: '0x8' },
                size: '2',
              },
            },
          },
        },
      },
    })
    mockedGetDynamicFieldObject.mockImplementation(async ({ name }: { name: { value: string } }) => {
      if (name.value === 'sprite.config.v1') {
        return { data: { content: { fields: { value: '{"fps":12}' } } } }
      }
      if (name.value === 'sprite.mood_map.v1') {
        return { data: { content: { fields: { value: '{"idle":"idle"}' } } } }
      }
      return { data: { content: null } }
    })

    const { getSoulMetadataObject } = await import('../../web/lib/soulidity/queries')

    await expect(getSoulMetadataObject('0x5', '0x42')).resolves.toMatchObject({
      objectId: '0x5',
      packageId: '0x0000000000000000000000000000000000000000000000000000000000000042',
      soulId: '0x0000000000000000000000000000000000000000000000000000000000000006',
      activeSprite: {
        assetName: 'persona-sprite',
        versionIndex: 1,
        downloadPolicy: 'public',
      },
      activeVoice: null,
      extTableId: '0x0000000000000000000000000000000000000000000000000000000000000008',
      spriteConfigJson: '{"fps":12}',
      spriteMoodMapJson: '{"idle":"idle"}',
      voiceConfigJson: null,
    })
  })
})
