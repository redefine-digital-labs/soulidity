import { beforeEach, describe, expect, it, vi } from 'vitest'

const OWNER_ADDRESS = `0x${'1'.repeat(64)}`
const FIRST_CAP_ID = `0x${'2'.repeat(64)}`
const SECOND_CAP_ID = `0x${'3'.repeat(64)}`
const SECOND_KIOSK_ID = `0x${'4'.repeat(64)}`

const mockedSuiClient = vi.hoisted(() => ({
  getOwnedObjects: vi.fn(),
}))
const mockedGetVerifiedPersonalKioskCapState = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/sui', () => ({
  suiClient: mockedSuiClient,
}))

vi.mock('@web/lib/souls/kiosk-package', () => ({
  getVendoredKioskPackageAddress: () => `0x${'9'.repeat(64)}`,
}))

vi.mock('@web/lib/souls/on-chain-verification', () => ({
  getVerifiedPersonalKioskCapState: mockedGetVerifiedPersonalKioskCapState,
  sameSuiValue: (a: string | null | undefined, b: string | null | undefined) => a?.toLowerCase() === b?.toLowerCase(),
}))

describe('personal kiosk resolution helpers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedSuiClient.getOwnedObjects.mockResolvedValueOnce({
      data: [{ data: { objectId: FIRST_CAP_ID } }],
      hasNextPage: true,
      nextCursor: 'cursor-2',
    }).mockResolvedValueOnce({
      data: [{ data: { objectId: SECOND_CAP_ID } }],
      hasNextPage: false,
      nextCursor: null,
    })
    mockedGetVerifiedPersonalKioskCapState
      .mockResolvedValueOnce({
        objectId: FIRST_CAP_ID,
        ownerAddress: `0x${'f'.repeat(64)}`,
        kioskId: `0x${'8'.repeat(64)}`,
      })
      .mockResolvedValueOnce({
        objectId: SECOND_CAP_ID,
        ownerAddress: OWNER_ADDRESS,
        kioskId: SECOND_KIOSK_ID,
      })
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
    expect(mockedGetVerifiedPersonalKioskCapState).toHaveBeenCalledWith(SECOND_CAP_ID)
  })

  it('returns missing when no verified kiosk caps belong to the requested owners', async () => {
    mockedSuiClient.getOwnedObjects.mockReset()
    mockedSuiClient.getOwnedObjects.mockResolvedValueOnce({
      data: [],
      hasNextPage: false,
      nextCursor: null,
    })
    mockedGetVerifiedPersonalKioskCapState.mockReset()

    const { resolveOwnedPersonalKiosk } = await import('../../web/lib/souls/personal-kiosk.ts')

    await expect(resolveOwnedPersonalKiosk({ ownerAddresses: [OWNER_ADDRESS] })).resolves.toEqual({
      status: 'missing',
    })
    expect(mockedGetVerifiedPersonalKioskCapState).not.toHaveBeenCalled()
  })

  it('returns multiple when more than one verified kiosk cap belongs to the owner set', async () => {
    mockedSuiClient.getOwnedObjects.mockReset()
    mockedSuiClient.getOwnedObjects.mockResolvedValueOnce({
      data: [{ data: { objectId: FIRST_CAP_ID } }, { data: { objectId: SECOND_CAP_ID } }],
      hasNextPage: false,
      nextCursor: null,
    })
    mockedGetVerifiedPersonalKioskCapState.mockReset()
    mockedGetVerifiedPersonalKioskCapState
      .mockResolvedValueOnce({
        objectId: FIRST_CAP_ID,
        ownerAddress: OWNER_ADDRESS,
        kioskId: `0x${'7'.repeat(64)}`,
      })
      .mockResolvedValueOnce({
        objectId: SECOND_CAP_ID,
        ownerAddress: OWNER_ADDRESS,
        kioskId: SECOND_KIOSK_ID,
      })

    const { resolveOwnedPersonalKiosk } = await import('../../web/lib/souls/personal-kiosk.ts')

    await expect(resolveOwnedPersonalKiosk({ ownerAddresses: [OWNER_ADDRESS] })).resolves.toEqual({
      status: 'multiple',
      kiosks: [
        {
          ownerAddress: OWNER_ADDRESS,
          currentKioskId: `0x${'7'.repeat(64)}`,
          currentKioskCapOnChainId: FIRST_CAP_ID,
        },
        {
          ownerAddress: OWNER_ADDRESS,
          currentKioskId: SECOND_KIOSK_ID,
          currentKioskCapOnChainId: SECOND_CAP_ID,
        },
      ],
    })
  })

  it('propagates verification errors when kiosk-cap inspection fails', async () => {
    mockedSuiClient.getOwnedObjects.mockReset()
    mockedSuiClient.getOwnedObjects.mockResolvedValueOnce({
      data: [{ data: { objectId: FIRST_CAP_ID } }],
      hasNextPage: false,
      nextCursor: null,
    })
    mockedGetVerifiedPersonalKioskCapState.mockReset()
    mockedGetVerifiedPersonalKioskCapState.mockRejectedValueOnce(new Error('RPC unavailable'))

    const { resolveOwnedPersonalKiosk } = await import('../../web/lib/souls/personal-kiosk.ts')

    await expect(resolveOwnedPersonalKiosk({ ownerAddresses: [OWNER_ADDRESS] })).rejects.toThrow('RPC unavailable')
  })
})
