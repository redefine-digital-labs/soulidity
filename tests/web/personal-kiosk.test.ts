import { beforeEach, describe, expect, it, vi } from 'vitest'

const OWNER_ADDRESS = `0x${'1'.repeat(64)}`
const FIRST_CAP_ID = `0x${'2'.repeat(64)}`
const SECOND_CAP_ID = `0x${'3'.repeat(64)}`
const SECOND_KIOSK_ID = `0x${'4'.repeat(64)}`
const MARKET_CONFIG_ID = `0x${'5'.repeat(64)}`
const MARKET_PACKAGE_ID = `0x${'6'.repeat(64)}`

const mockedSuiClient = vi.hoisted(() => ({
  getOwnedObjects: vi.fn(),
  getDynamicFieldObject: vi.fn(),
  getObject: vi.fn(),
}))
const mockedGetVerifiedPersonalKioskCapStates = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/sui', () => ({
  suiClient: mockedSuiClient,
}))

vi.mock('@web/lib/souls/kiosk-package', () => ({
  getVendoredKioskPackageAddress: () => `0x${'9'.repeat(64)}`,
}))

vi.mock('@web/lib/souls/on-chain-verification', () => ({
  getVerifiedPersonalKioskCapStates: mockedGetVerifiedPersonalKioskCapStates,
  sameSuiValue: (a: string | null | undefined, b: string | null | undefined) => a?.toLowerCase() === b?.toLowerCase(),
}))

describe('personal kiosk resolution helpers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID = MARKET_CONFIG_ID
    mockedSuiClient.getOwnedObjects.mockResolvedValueOnce({
      data: [{ data: { objectId: FIRST_CAP_ID } }],
      hasNextPage: true,
      nextCursor: 'cursor-2',
    }).mockResolvedValueOnce({
      data: [{ data: { objectId: SECOND_CAP_ID } }],
      hasNextPage: false,
      nextCursor: null,
    })
    mockedGetVerifiedPersonalKioskCapStates
      .mockResolvedValueOnce([
        {
          objectId: FIRST_CAP_ID,
          ownerAddress: `0x${'f'.repeat(64)}`,
          kioskId: `0x${'8'.repeat(64)}`,
        },
        {
          objectId: SECOND_CAP_ID,
          ownerAddress: OWNER_ADDRESS,
          kioskId: SECOND_KIOSK_ID,
        },
      ])
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: MARKET_CONFIG_ID,
        type: `${MARKET_PACKAGE_ID}::market::MarketConfig`,
      },
    })
    mockedSuiClient.getDynamicFieldObject.mockRejectedValue(new Error('No dynamic field found'))
  })

  it('pages through owned personal kiosk caps before concluding no kiosk exists', async () => {
    const { resolveOwnedPersonalKiosk } = await import('../../web/lib/souls/personal-kiosk.ts')

    await expect(resolveOwnedPersonalKiosk({ ownerAddresses: [OWNER_ADDRESS] })).resolves.toEqual({
      status: 'ready',
      kiosk: {
        ownerAddress: OWNER_ADDRESS,
        currentKioskId: SECOND_KIOSK_ID,
        currentKioskCapOnChainId: SECOND_CAP_ID,
      },
    })

    expect(mockedSuiClient.getOwnedObjects).toHaveBeenNthCalledWith(1, {
      owner: OWNER_ADDRESS,
      filter: { StructType: `${`0x${'9'.repeat(64)}`}::personal_kiosk::PersonalKioskCap` },
      options: { showType: true },
    })
    expect(mockedSuiClient.getOwnedObjects).toHaveBeenNthCalledWith(2, {
      owner: OWNER_ADDRESS,
      cursor: 'cursor-2',
      filter: { StructType: `${`0x${'9'.repeat(64)}`}::personal_kiosk::PersonalKioskCap` },
      options: { showType: true },
    })
    expect(mockedGetVerifiedPersonalKioskCapStates).toHaveBeenCalledWith([FIRST_CAP_ID, SECOND_CAP_ID])
  })

  it('returns missing when no verified kiosk caps belong to the requested owners', async () => {
    mockedSuiClient.getOwnedObjects.mockReset()
    mockedSuiClient.getOwnedObjects.mockResolvedValueOnce({
      data: [],
      hasNextPage: false,
      nextCursor: null,
    })
    mockedGetVerifiedPersonalKioskCapStates.mockReset()
    mockedGetVerifiedPersonalKioskCapStates.mockResolvedValueOnce([])

    const { resolveOwnedPersonalKiosk } = await import('../../web/lib/souls/personal-kiosk.ts')

    await expect(resolveOwnedPersonalKiosk({ ownerAddresses: [OWNER_ADDRESS] })).resolves.toEqual({
      status: 'missing',
    })
    expect(mockedGetVerifiedPersonalKioskCapStates).toHaveBeenCalledWith([])
  })

  it('prefers the registry kiosk when multiple kiosks exist', async () => {
    const FIRST_KIOSK_ID = `0x${'7'.repeat(64)}`
    mockedSuiClient.getOwnedObjects.mockReset()
    mockedSuiClient.getOwnedObjects.mockResolvedValueOnce({
      data: [{ data: { objectId: FIRST_CAP_ID } }, { data: { objectId: SECOND_CAP_ID } }],
      hasNextPage: false,
      nextCursor: null,
    })
    mockedGetVerifiedPersonalKioskCapStates.mockReset()
    mockedGetVerifiedPersonalKioskCapStates
      .mockResolvedValueOnce([{
        objectId: FIRST_CAP_ID,
        ownerAddress: OWNER_ADDRESS,
        kioskId: FIRST_KIOSK_ID,
      }, {
        objectId: SECOND_CAP_ID,
        ownerAddress: OWNER_ADDRESS,
        kioskId: SECOND_KIOSK_ID,
      }])
    mockedSuiClient.getDynamicFieldObject.mockResolvedValueOnce({
      data: {
        objectId: `0x${'8'.repeat(64)}`,
        content: {
          dataType: 'moveObject',
          fields: {
            value: {
              fields: {
                kiosk_id: SECOND_KIOSK_ID,
                kiosk_cap_id: SECOND_CAP_ID,
              },
            },
          },
        },
      },
    })

    const { resolveOwnedPersonalKiosk } = await import('../../web/lib/souls/personal-kiosk.ts')
    const result = await resolveOwnedPersonalKiosk({ ownerAddresses: [OWNER_ADDRESS] })

    expect(result).toEqual({
      status: 'ready',
      kiosk: {
        currentKioskCapOnChainId: SECOND_CAP_ID,
        currentKioskId: SECOND_KIOSK_ID,
        ownerAddress: OWNER_ADDRESS,
      },
    })
  })

  it('picks the lowest kiosk id when multiple kiosks exist without a registry entry', async () => {
    const FIRST_KIOSK_ID = `0x${'0'.repeat(63)}7`
    mockedSuiClient.getOwnedObjects.mockReset()
    mockedSuiClient.getOwnedObjects.mockResolvedValueOnce({
      data: [{ data: { objectId: FIRST_CAP_ID } }, { data: { objectId: SECOND_CAP_ID } }],
      hasNextPage: false,
      nextCursor: null,
    })
    mockedGetVerifiedPersonalKioskCapStates.mockReset()
    mockedGetVerifiedPersonalKioskCapStates
      .mockResolvedValueOnce([{
        objectId: FIRST_CAP_ID,
        ownerAddress: OWNER_ADDRESS,
        kioskId: FIRST_KIOSK_ID,
      }, {
        objectId: SECOND_CAP_ID,
        ownerAddress: OWNER_ADDRESS,
        kioskId: SECOND_KIOSK_ID,
      }])

    const { resolveOwnedPersonalKiosk } = await import('../../web/lib/souls/personal-kiosk.ts')

    await expect(resolveOwnedPersonalKiosk({ ownerAddresses: [OWNER_ADDRESS] }))
      .resolves.toEqual({
        status: 'ready',
        kiosk: {
          ownerAddress: OWNER_ADDRESS,
          currentKioskId: FIRST_KIOSK_ID,
          currentKioskCapOnChainId: FIRST_CAP_ID,
        },
      })
  })

  it('throws invariant error when the registry kiosk is not owned by the current wallet set', async () => {
    const FIRST_KIOSK_ID = `0x${'7'.repeat(64)}`
    const STALE_KIOSK_ID = `0x${'a'.repeat(64)}`
    const STALE_CAP_ID = `0x${'b'.repeat(64)}`
    mockedSuiClient.getOwnedObjects.mockReset()
    mockedSuiClient.getOwnedObjects.mockResolvedValueOnce({
      data: [{ data: { objectId: FIRST_CAP_ID } }, { data: { objectId: SECOND_CAP_ID } }],
      hasNextPage: false,
      nextCursor: null,
    })
    mockedGetVerifiedPersonalKioskCapStates.mockReset()
    mockedGetVerifiedPersonalKioskCapStates
      .mockResolvedValueOnce([{
        objectId: FIRST_CAP_ID,
        ownerAddress: OWNER_ADDRESS,
        kioskId: FIRST_KIOSK_ID,
      }, {
        objectId: SECOND_CAP_ID,
        ownerAddress: OWNER_ADDRESS,
        kioskId: SECOND_KIOSK_ID,
      }])
    mockedSuiClient.getDynamicFieldObject.mockResolvedValueOnce({
      data: {
        objectId: `0x${'8'.repeat(64)}`,
        content: {
          dataType: 'moveObject',
          fields: {
            value: {
              fields: {
                kiosk_id: STALE_KIOSK_ID,
                kiosk_cap_id: STALE_CAP_ID,
              },
            },
          },
        },
      },
    })

    const { resolveOwnedPersonalKiosk, SoulPersonalKioskInvariantError } = await import('../../web/lib/souls/personal-kiosk.ts')

    await expect(resolveOwnedPersonalKiosk({ ownerAddresses: [OWNER_ADDRESS] }))
      .rejects.toBeInstanceOf(SoulPersonalKioskInvariantError)
  })

  it('propagates verification errors when kiosk-cap inspection fails', async () => {
    mockedSuiClient.getOwnedObjects.mockReset()
    mockedSuiClient.getOwnedObjects.mockResolvedValueOnce({
      data: [{ data: { objectId: FIRST_CAP_ID } }],
      hasNextPage: false,
      nextCursor: null,
    })
    mockedGetVerifiedPersonalKioskCapStates.mockReset()
    mockedGetVerifiedPersonalKioskCapStates.mockRejectedValueOnce(new Error('RPC unavailable'))

    const { resolveOwnedPersonalKiosk } = await import('../../web/lib/souls/personal-kiosk.ts')

    await expect(resolveOwnedPersonalKiosk({ ownerAddresses: [OWNER_ADDRESS] })).rejects.toThrow('RPC unavailable')
  })
})
