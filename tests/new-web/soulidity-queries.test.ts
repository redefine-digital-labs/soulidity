import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OFFICIAL_MAINNET_KIOSK_PACKAGE_ID,
  OFFICIAL_MAINNET_PERSONAL_KIOSK_CAP_TYPE_PACKAGE_ID,
} from '../../web/lib/soulidity/kiosk'

const mockedGetObject = vi.hoisted(() => vi.fn())
const mockedGetOwnedObjects = vi.hoisted(() => vi.fn())
const mockedGetDynamicFields = vi.hoisted(() => vi.fn())
const mockedGetDynamicFieldObject = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/sui', () => ({
  suiClient: {
    getObject: mockedGetObject,
    getOwnedObjects: mockedGetOwnedObjects,
    getDynamicFields: mockedGetDynamicFields,
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

  it('parses SoulState active grants from the Table dynamic fields', async () => {
    mockedGetObject.mockResolvedValue({
      data: {
        objectId: '0x5',
        type: '0x42::soul::SoulState',
        content: {
          dataType: 'moveObject',
          type: '0x42::soul::SoulState',
          fields: {
            soul_id: '0x6',
            creator: '0xc0de',
            creator_royalty_bps: '500',
            current_owner: '0xc0de',
            current_kiosk_id: '0x7',
            ownership_epoch: '3',
            grant_capacity: '10000',
            active_grant_count: '1',
            active_grants: {
              type: '0x2::table::Table<address, 0x42::soul::ActiveGrantSlot>',
              fields: {
                id: { id: '0x8' },
                size: '2',
              },
            },
            active_grant_ids: {
              fields: {
                id: { id: '0x9' },
                size: '2',
              },
            },
            memory_id: [],
            metadata_id: [],
            skills_id: [],
            assets_id: [],
            collection_id: [],
            access_list_id: [],
          },
        },
      },
    })
    mockedGetDynamicFields.mockResolvedValue({
      data: [{
        name: {
          type: 'address',
          value: '0xaaa',
        },
      }],
      hasNextPage: false,
      nextCursor: null,
    })
    mockedGetDynamicFieldObject.mockResolvedValue({
      data: {
        content: {
          fields: {
            name: '0xaaa',
            value: {
              fields: {
                grant_id: '0xabc',
                grantee: '0xaaa',
                scope_mask: '5',
                expires_at_ms: [],
                ownership_epoch_snapshot: '3',
              },
            },
          },
        },
      },
    })

    const { getSoulStateObject } = await import('../../web/lib/soulidity/queries')
    await expect(getSoulStateObject('0x5', '0x42')).resolves.toMatchObject({
      objectId: '0x5',
      activeGrantCount: 1,
      activeGrants: [{
        grantId: '0x0000000000000000000000000000000000000000000000000000000000000abc',
        granteeAddress: '0x0000000000000000000000000000000000000000000000000000000000000aaa',
        scopeMask: 5,
        scopes: ['seal', 'skills'],
        expiresAtMs: null,
        ownershipEpochSnapshot: 3,
      }],
    })
    expect(mockedGetDynamicFields).toHaveBeenCalledWith({
      parentId: '0x0000000000000000000000000000000000000000000000000000000000000008',
      cursor: undefined,
      limit: 50,
    })
  })

  it('does not scan stale table-backed active grant rows when the active count is zero', async () => {
    mockedGetObject.mockResolvedValue({
      data: {
        objectId: '0x5',
        type: '0x42::soul::SoulState',
        content: {
          dataType: 'moveObject',
          type: '0x42::soul::SoulState',
          fields: {
            soul_id: '0x6',
            creator: '0xc0de',
            creator_royalty_bps: '500',
            current_owner: '0xc0de',
            current_kiosk_id: '0x7',
            ownership_epoch: '4',
            grant_capacity: '10000',
            active_grant_count: '0',
            active_grants: {
              type: '0x2::table::Table<address, 0x42::soul::ActiveGrantSlot>',
              fields: {
                id: { id: '0x8' },
                size: '1',
              },
            },
            active_grant_ids: {
              fields: {
                id: { id: '0x9' },
                size: '0',
              },
            },
            memory_id: [],
            metadata_id: [],
            skills_id: [],
            assets_id: [],
            collection_id: [],
            access_list_id: [],
          },
        },
      },
    })
    mockedGetDynamicFields.mockResolvedValue({
      data: [{
        name: {
          type: 'address',
          value: '0xaaa',
        },
      }],
      hasNextPage: false,
      nextCursor: null,
    })
    mockedGetDynamicFieldObject.mockResolvedValue({
      data: {
        content: {
          fields: {
            name: '0xaaa',
            value: {
              fields: {
                grant_id: '0xabc',
                grantee: '0xaaa',
                scope_mask: '5',
                expires_at_ms: [],
                ownership_epoch_snapshot: '3',
              },
            },
          },
        },
      },
    })

    const { getSoulStateObject } = await import('../../web/lib/soulidity/queries')
    await expect(getSoulStateObject('0x5', '0x42')).resolves.toMatchObject({
      ownershipEpoch: 4,
      activeGrantCount: 0,
      activeGrants: [],
    })
    expect(mockedGetDynamicFields).not.toHaveBeenCalled()
  })

  it('can read SoulState headers without materializing table-backed active grants', async () => {
    mockedGetObject.mockResolvedValue({
      data: {
        objectId: '0x5',
        type: '0x42::soul::SoulState',
        content: {
          dataType: 'moveObject',
          type: '0x42::soul::SoulState',
          fields: {
            soul_id: '0x6',
            creator: '0xc0de',
            creator_royalty_bps: '500',
            current_owner: '0xc0de',
            current_kiosk_id: '0x7',
            ownership_epoch: '4',
            grant_capacity: '10000',
            active_grant_count: '1',
            active_grants: {
              type: '0x2::table::Table<address, 0x42::soul::ActiveGrantSlot>',
              fields: {
                id: { id: '0x8' },
                size: '1',
              },
            },
            memory_id: [],
            metadata_id: [],
            skills_id: [],
            assets_id: [],
            collection_id: [],
            access_list_id: [],
          },
        },
      },
    })

    const { getSoulStateObject } = await import('../../web/lib/soulidity/queries')
    await expect(getSoulStateObject('0x5', '0x42', { includeActiveGrants: false })).resolves.toMatchObject({
      ownershipEpoch: 4,
      activeGrantCount: 1,
      activeGrants: [],
      activeGrantsTableId: '0x0000000000000000000000000000000000000000000000000000000000000008',
    })
    expect(mockedGetDynamicFields).not.toHaveBeenCalled()
    expect(mockedGetDynamicFieldObject).not.toHaveBeenCalled()
  })

  it('looks up a table-backed active grant directly by grantee address', async () => {
    mockedGetDynamicFieldObject.mockResolvedValue({
      data: {
        content: {
          fields: {
            name: '0xaaa',
            value: {
              fields: {
                grant_id: '0xabc',
                grantee: '0xaaa',
                scope_mask: '8',
                expires_at_ms: [],
                ownership_epoch_snapshot: '4',
              },
            },
          },
        },
      },
    })

    const { getActiveGrantSlotForGrantee } = await import('../../web/lib/soulidity/queries')
    await expect(getActiveGrantSlotForGrantee({
      objectId: '0x5',
      packageId: '0x42',
      soulId: '0x6',
      creatorAddress: '0xc0de',
      creatorRoyaltyBps: 500,
      currentOwnerAddress: '0xc0de',
      currentKioskId: '0x7',
      ownershipEpoch: 4,
      grantCapacity: 10000,
      activeGrantCount: 1,
      activeGrants: [],
      activeGrantsTableId: '0x8',
      memoryId: null,
      metadataId: null,
      skillsId: null,
      assetsId: null,
      accessListId: null,
      collectionId: null,
    }, '0xaaa')).resolves.toMatchObject({
      grantId: '0x0000000000000000000000000000000000000000000000000000000000000abc',
      granteeAddress: '0x0000000000000000000000000000000000000000000000000000000000000aaa',
      scopeMask: 8,
      scopes: ['assets'],
      ownershipEpochSnapshot: 4,
    })
    expect(mockedGetDynamicFields).not.toHaveBeenCalled()
    expect(mockedGetDynamicFieldObject).toHaveBeenCalledWith({
      parentId: '0x8',
      name: {
        type: 'address',
        value: '0x0000000000000000000000000000000000000000000000000000000000000aaa',
      },
    })
  })

  it('continues table-backed active grant pagination until the current active count is satisfied', async () => {
    mockedGetObject.mockResolvedValue({
      data: {
        objectId: '0x5',
        type: '0x42::soul::SoulState',
        content: {
          dataType: 'moveObject',
          type: '0x42::soul::SoulState',
          fields: {
            soul_id: '0x6',
            creator: '0xc0de',
            creator_royalty_bps: '500',
            current_owner: '0xc0de',
            current_kiosk_id: '0x7',
            ownership_epoch: '4',
            grant_capacity: '10000',
            active_grant_count: '1',
            active_grants: {
              type: '0x2::table::Table<address, 0x42::soul::ActiveGrantSlot>',
              fields: {
                id: { id: '0x8' },
                size: '21',
              },
            },
            active_grant_ids: {
              fields: {
                id: { id: '0x9' },
                size: '1',
              },
            },
            memory_id: [],
            metadata_id: [],
            skills_id: [],
            assets_id: [],
            collection_id: [],
            access_list_id: [],
          },
        },
      },
    })
    for (let index = 0; index < 21; index += 1) {
      const grantee = `0x${(0xaaa + index).toString(16)}`
      mockedGetDynamicFields.mockResolvedValueOnce({
        data: [{
          name: {
            type: 'address',
            value: grantee,
          },
        }],
        hasNextPage: true,
        nextCursor: `cursor-${index + 2}`,
      })
    }
    mockedGetDynamicFieldObject.mockImplementation(async ({ name }: { name: { value: string } }) => ({
      data: {
        content: {
          fields: {
            name: name.value,
            value: {
              fields: {
                grant_id: name.value === '0xabe' ? '0xabc' : `0x${name.value.slice(2)}01`,
                grantee: name.value,
                scope_mask: '8',
                expires_at_ms: [],
                ownership_epoch_snapshot: name.value === '0xabe' ? '4' : '3',
              },
            },
          },
        },
      },
    }))

    const { getSoulStateObject } = await import('../../web/lib/soulidity/queries')
    await expect(getSoulStateObject('0x5', '0x42')).resolves.toMatchObject({
      ownershipEpoch: 4,
      activeGrantCount: 1,
      activeGrants: [{
        grantId: '0x0000000000000000000000000000000000000000000000000000000000000abc',
        granteeAddress: '0x0000000000000000000000000000000000000000000000000000000000000abe',
        scopeMask: 8,
        scopes: ['assets'],
        ownershipEpochSnapshot: 4,
      }],
    })
    expect(mockedGetDynamicFields).toHaveBeenCalledTimes(21)
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
    expect(OFFICIAL_MAINNET_PERSONAL_KIOSK_CAP_TYPE_PACKAGE_ID).toBe(
      '0x434b5bd8f6a7b05fede0ff46c6e511d71ea326ed38056e3bcd681d2d7c2a7879',
    )
    mockedGetOwnedObjects.mockResolvedValueOnce({
      data: [{
        data: {
          objectId: '0x1',
          type: `${OFFICIAL_MAINNET_PERSONAL_KIOSK_CAP_TYPE_PACKAGE_ID}::personal_kiosk::PersonalKioskCap`,
          owner: { AddressOwner: '0xabc' },
          content: {
            dataType: 'moveObject',
            type: `${OFFICIAL_MAINNET_PERSONAL_KIOSK_CAP_TYPE_PACKAGE_ID}::personal_kiosk::PersonalKioskCap`,
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
        StructType: `${OFFICIAL_MAINNET_PERSONAL_KIOSK_CAP_TYPE_PACKAGE_ID}::personal_kiosk::PersonalKioskCap`,
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
