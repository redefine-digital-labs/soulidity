import { beforeEach, describe, expect, it, vi } from 'vitest'

const OWNER_ADDRESS = `0x${'1'.repeat(64)}`
const MARKET_CONFIG_ID = `0x${'2'.repeat(64)}`
const MARKET_PACKAGE_ID = `0x${'3'.repeat(64)}`
const ACTIVE_KIOSK_ID = `0x${'4'.repeat(64)}`
const ACTIVE_CAP_ID = `0x${'5'.repeat(64)}`
const STALE_KIOSK_ID = `0x${'6'.repeat(64)}`
const STALE_CAP_ID = `0x${'7'.repeat(64)}`
const SECOND_KIOSK_ID = `0x${'8'.repeat(64)}`
const SECOND_CAP_ID = `0x${'9'.repeat(64)}`
const LOWEST_KIOSK_ID = `0x${'0'.repeat(63)}a`

const mockedGetMarketConfig = vi.hoisted(() => vi.fn())
const mockedGetRegisteredPersonalKiosk = vi.hoisted(() => vi.fn())
const mockedListOwnedPersonalKioskCaps = vi.hoisted(() => vi.fn())
const mockedFilterExistingPersonalKiosks = vi.hoisted(() => vi.fn())

const mockedNormalizeSuiValue = vi.hoisted(
  () =>
    (value: string): string | null => {
      const trimmed = value.trim()
      if (!trimmed.startsWith('0x')) return null
      const hex = trimmed.slice(2).toLowerCase()
      if (!/^[0-9a-f]+$/.test(hex)) return null
      return `0x${hex.padStart(64, '0')}`
    },
)

const mockedSameSuiValue = vi.hoisted(
  () =>
    (left: string | null | undefined, right: string | null | undefined): boolean => {
      if (!left || !right) return false
      const normalizedLeft = mockedNormalizeSuiValue(left)
      const normalizedRight = mockedNormalizeSuiValue(right)
      return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
    },
)

vi.mock('@/lib/soulidity/env', () => ({
  getRequiredSoulidityEnv: vi.fn((key: string) => {
    if (key === 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID') return MARKET_CONFIG_ID
    if (key === 'NEXT_PUBLIC_SOULIDITY_PACKAGE_ID') return MARKET_PACKAGE_ID
    throw new Error(`Unexpected env key: ${key}`)
  }),
}))

vi.mock('@/lib/soulidity/queries', () => ({
  getMarketConfig: mockedGetMarketConfig,
  getRegisteredPersonalKiosk: mockedGetRegisteredPersonalKiosk,
  listOwnedPersonalKioskCaps: mockedListOwnedPersonalKioskCaps,
  filterExistingPersonalKiosks: mockedFilterExistingPersonalKiosks,
  normalizeSuiValue: mockedNormalizeSuiValue,
  sameSuiValue: mockedSameSuiValue,
}))

describe('new-web personal kiosk resolution', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedGetMarketConfig.mockResolvedValue({
      objectId: MARKET_CONFIG_ID,
      packageId: MARKET_PACKAGE_ID,
    })
    mockedFilterExistingPersonalKiosks.mockImplementation(async (kiosks) => kiosks)
  })

  it('returns missing when the wallet owns no personal kiosk caps', async () => {
    mockedListOwnedPersonalKioskCaps.mockResolvedValueOnce([])

    const { resolveOwnedPersonalKiosk } = await import('../../new-web/lib/soulidity/personal-kiosk')

    await expect(resolveOwnedPersonalKiosk({ ownerAddresses: [OWNER_ADDRESS] })).resolves.toEqual({
      status: 'missing',
    })
  })

  it('returns the registry-matched kiosk when the registration is current', async () => {
    mockedListOwnedPersonalKioskCaps.mockResolvedValueOnce([{
      ownerAddress: OWNER_ADDRESS,
      currentKioskId: ACTIVE_KIOSK_ID,
      currentKioskCapOnChainId: ACTIVE_CAP_ID,
    }])
    mockedGetRegisteredPersonalKiosk.mockResolvedValueOnce({
      kioskId: ACTIVE_KIOSK_ID,
      kioskCapOnChainId: ACTIVE_CAP_ID,
    })

    const { resolveOwnedPersonalKiosk } = await import('../../new-web/lib/soulidity/personal-kiosk')

    await expect(resolveOwnedPersonalKiosk({ ownerAddresses: [OWNER_ADDRESS] })).resolves.toEqual({
      status: 'ready',
      kiosk: {
        ownerAddress: OWNER_ADDRESS,
        currentKioskId: ACTIVE_KIOSK_ID,
        currentKioskCapOnChainId: ACTIVE_CAP_ID,
      },
    })
  })

  it('falls back to the wallet-owned kiosk when the registry is stale but only one kiosk is still owned', async () => {
    mockedListOwnedPersonalKioskCaps.mockResolvedValueOnce([{
      ownerAddress: OWNER_ADDRESS,
      currentKioskId: ACTIVE_KIOSK_ID,
      currentKioskCapOnChainId: ACTIVE_CAP_ID,
    }])
    mockedGetRegisteredPersonalKiosk.mockResolvedValueOnce({
      kioskId: STALE_KIOSK_ID,
      kioskCapOnChainId: STALE_CAP_ID,
    })

    const { resolveOwnedPersonalKiosk } = await import('../../new-web/lib/soulidity/personal-kiosk')

    await expect(resolveOwnedPersonalKiosk({ ownerAddresses: [OWNER_ADDRESS] })).resolves.toEqual({
      status: 'ready',
      kiosk: {
        ownerAddress: OWNER_ADDRESS,
        currentKioskId: ACTIVE_KIOSK_ID,
        currentKioskCapOnChainId: ACTIVE_CAP_ID,
      },
    })
  })

  it('picks the lowest kiosk id when multiple kiosks exist without a registry entry', async () => {
    mockedListOwnedPersonalKioskCaps.mockResolvedValueOnce([
      {
        ownerAddress: OWNER_ADDRESS,
        currentKioskId: SECOND_KIOSK_ID,
        currentKioskCapOnChainId: SECOND_CAP_ID,
      },
      {
        ownerAddress: OWNER_ADDRESS,
        currentKioskId: LOWEST_KIOSK_ID,
        currentKioskCapOnChainId: ACTIVE_CAP_ID,
      },
    ])
    mockedGetRegisteredPersonalKiosk.mockResolvedValueOnce(null)

    const { resolveOwnedPersonalKiosk } = await import('../../new-web/lib/soulidity/personal-kiosk')

    await expect(resolveOwnedPersonalKiosk({ ownerAddresses: [OWNER_ADDRESS] })).resolves.toEqual({
      status: 'ready',
      kiosk: {
        ownerAddress: OWNER_ADDRESS,
        currentKioskId: LOWEST_KIOSK_ID,
        currentKioskCapOnChainId: ACTIVE_CAP_ID,
      },
    })
  })

  it('picks the lowest kiosk id when the registry is stale and the wallet owns multiple kiosks', async () => {
    mockedListOwnedPersonalKioskCaps.mockResolvedValueOnce([
      {
        ownerAddress: OWNER_ADDRESS,
        currentKioskId: ACTIVE_KIOSK_ID,
        currentKioskCapOnChainId: ACTIVE_CAP_ID,
      },
      {
        ownerAddress: OWNER_ADDRESS,
        currentKioskId: SECOND_KIOSK_ID,
        currentKioskCapOnChainId: SECOND_CAP_ID,
      },
    ])
    mockedGetRegisteredPersonalKiosk.mockResolvedValueOnce({
      kioskId: STALE_KIOSK_ID,
      kioskCapOnChainId: STALE_CAP_ID,
    })

    const { resolveOwnedPersonalKiosk } = await import('../../new-web/lib/soulidity/personal-kiosk')

    await expect(resolveOwnedPersonalKiosk({ ownerAddresses: [OWNER_ADDRESS] })).resolves.toEqual({
      status: 'ready',
      kiosk: {
        ownerAddress: OWNER_ADDRESS,
        currentKioskId: ACTIVE_KIOSK_ID,
        currentKioskCapOnChainId: ACTIVE_CAP_ID,
      },
    })
  })

  it('filters out owned kiosk caps whose kiosk object no longer exists', async () => {
    mockedListOwnedPersonalKioskCaps.mockResolvedValueOnce([
      {
        ownerAddress: OWNER_ADDRESS,
        currentKioskId: STALE_KIOSK_ID,
        currentKioskCapOnChainId: ACTIVE_CAP_ID,
      },
      {
        ownerAddress: OWNER_ADDRESS,
        currentKioskId: ACTIVE_KIOSK_ID,
        currentKioskCapOnChainId: SECOND_CAP_ID,
      },
    ])
    mockedFilterExistingPersonalKiosks.mockResolvedValueOnce([
      {
        ownerAddress: OWNER_ADDRESS,
        currentKioskId: ACTIVE_KIOSK_ID,
        currentKioskCapOnChainId: SECOND_CAP_ID,
      },
    ])
    mockedGetRegisteredPersonalKiosk.mockResolvedValueOnce({
      kioskId: STALE_KIOSK_ID,
      kioskCapOnChainId: ACTIVE_CAP_ID,
    })

    const { resolveOwnedPersonalKiosk } = await import('../../new-web/lib/soulidity/personal-kiosk')

    await expect(resolveOwnedPersonalKiosk({ ownerAddresses: [OWNER_ADDRESS] })).resolves.toEqual({
      status: 'ready',
      kiosk: {
        ownerAddress: OWNER_ADDRESS,
        currentKioskId: ACTIVE_KIOSK_ID,
        currentKioskCapOnChainId: SECOND_CAP_ID,
      },
    })
  })
})
