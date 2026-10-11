import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module-level mocks — prevent real SuiClient instantiation and Walrus config
// ---------------------------------------------------------------------------

vi.mock('@soulidity/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@soulidity/sdk')>()
  return {
    ...actual,
    suiClient: {
      getObject: vi.fn(),
      getTransactionBlock: vi.fn(),
      waitForTransaction: vi.fn(),
    },
    normalizeWalrusBlobId: vi.fn((v: unknown) => (typeof v === 'string' ? v : null)),
  }
})

// ---------------------------------------------------------------------------
// Import the module under test (after mocks are in place)
// ---------------------------------------------------------------------------

import {
  normalizeSuiValue,
  sameSuiValue,
  scopeMaskToScopes,
  getTrustedPackageIds,
  getVendoredKioskPackageAddress,
  getPersonalKioskCapTypePackageAddress,
  ensureTransactionSucceeded,
  readTransactionSender,
  quoteSoulPurchase,
  quoteCollectionPurchase,
  OnChainVerificationError,
} from '@soulidity/sdk'
import {
  OFFICIAL_MAINNET_KIOSK_PACKAGE_ID,
  OFFICIAL_MAINNET_PERSONAL_KIOSK_CAP_TYPE_PACKAGE_ID,
  OFFICIAL_TESTNET_KIOSK_PACKAGE_ID,
} from '@soulidity/sdk'
import {
  ALL_SOUL_GRANT_SCOPE_MASK,
  DEFAULT_ISSUE_SCOPE_MASK,
} from '@soulidity/sdk'
import type { SoulGrantScope } from '@soulidity/sdk'

// Fully padded zero address (64 hex digits after 0x)
const ZERO_66 = '0x' + '0'.repeat(64)

// ---------------------------------------------------------------------------
// normalizeSuiValue
// ---------------------------------------------------------------------------

describe('normalizeSuiValue', () => {
  it('pads short addresses to 66 characters', () => {
    const result = normalizeSuiValue('0x1')
    expect(result).toHaveLength(66)
    expect(result).toBe('0x' + '0'.repeat(63) + '1')
  })

  it('lowercases hex characters', () => {
    const result = normalizeSuiValue('0xABCD')
    expect(result).not.toBeNull()
    expect(result).toBe(result!.toLowerCase())
    expect(result).toMatch(/abcd$/)
  })

  it('handles already-padded addresses', () => {
    const full = '0x' + 'ab'.repeat(32)
    expect(normalizeSuiValue(full)).toBe(full)
  })

  it('trims whitespace around the input', () => {
    expect(normalizeSuiValue('  0x1  ')).toBe('0x' + '0'.repeat(63) + '1')
  })

  it('normalizes an empty string to the zero address (Sui SDK treats "" as 0x0)', () => {
    // The Sui SDK's normalizeSuiAddress('') produces a valid zero address
    expect(normalizeSuiValue('')).toBe(ZERO_66)
  })

  it('normalizes whitespace-only string to the zero address', () => {
    expect(normalizeSuiValue('   ')).toBe(ZERO_66)
  })

  it('returns null for non-hex string', () => {
    expect(normalizeSuiValue('not-hex')).toBeNull()
  })

  it('returns null for invalid hex characters after 0x prefix', () => {
    expect(normalizeSuiValue('0xGGGG')).toBeNull()
  })

  it('normalizes the zero address', () => {
    expect(normalizeSuiValue('0x0')).toBe(ZERO_66)
  })

  it('returns null for an address that is too long', () => {
    const tooLong = '0x' + 'a'.repeat(65)
    expect(normalizeSuiValue(tooLong)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// sameSuiValue
// ---------------------------------------------------------------------------

describe('sameSuiValue', () => {
  it('matches equivalent addresses with different padding', () => {
    const short = '0x1'
    const full = '0x' + '0'.repeat(63) + '1'
    expect(sameSuiValue(short, full)).toBe(true)
  })

  it('matches addresses with different casing', () => {
    expect(sameSuiValue('0xABC', '0xabc')).toBe(true)
  })

  it('returns false when left is null', () => {
    expect(sameSuiValue(null, '0x1')).toBe(false)
  })

  it('returns false when right is null', () => {
    expect(sameSuiValue('0x1', null)).toBe(false)
  })

  it('returns false when both are null', () => {
    expect(sameSuiValue(null, null)).toBe(false)
  })

  it('returns false when left is undefined', () => {
    expect(sameSuiValue(undefined, '0x1')).toBe(false)
  })

  it('returns false when right is undefined', () => {
    expect(sameSuiValue('0x1', undefined)).toBe(false)
  })

  it('returns false when both are undefined', () => {
    expect(sameSuiValue(undefined, undefined)).toBe(false)
  })

  it('returns false when left is an empty string', () => {
    expect(sameSuiValue('', '0x1')).toBe(false)
  })

  it('returns false for two different valid addresses', () => {
    expect(sameSuiValue('0x1', '0x2')).toBe(false)
  })

  it('returns true for identical full-length addresses', () => {
    const addr = '0x' + 'ab'.repeat(32)
    expect(sameSuiValue(addr, addr)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// scopeMaskToScopes
// ---------------------------------------------------------------------------

describe('scopeMaskToScopes', () => {
  it('keeps the GrantModal default aligned to every grant scope', () => {
    expect(DEFAULT_ISSUE_SCOPE_MASK).toBe(15)
    expect(DEFAULT_ISSUE_SCOPE_MASK).toBe(ALL_SOUL_GRANT_SCOPE_MASK)
    expect(scopeMaskToScopes(DEFAULT_ISSUE_SCOPE_MASK)).toEqual(['seal', 'memory', 'skills', 'assets'])
  })

  it.each<[number, SoulGrantScope[]]>([
    [0, []],
    [1, ['seal']],
    [2, ['memory']],
    [3, ['seal', 'memory']],
    [4, ['skills']],
    [5, ['seal', 'skills']],
    [6, ['memory', 'skills']],
    [7, ['seal', 'memory', 'skills']],
    [8, ['assets']],
    [9, ['seal', 'assets']],
    [12, ['skills', 'assets']],
    [15, ['seal', 'memory', 'skills', 'assets']],
  ])('maps bitmask %i to %j', (mask, expected) => {
    expect(scopeMaskToScopes(mask)).toEqual(expected)
  })

  it('ignores bits beyond the defined scopes', () => {
    // Bit 4 (value 16) and above are not defined grant scopes.
    expect(scopeMaskToScopes(16)).toEqual([])
    expect(scopeMaskToScopes(17)).toEqual(['seal'])
  })
})

// ---------------------------------------------------------------------------
// getTrustedPackageIds
// ---------------------------------------------------------------------------

describe('getTrustedPackageIds', () => {
  it('normalizes and returns valid package IDs', () => {
    const result = getTrustedPackageIds('0x1', '0x2')
    expect(result).toHaveLength(2)
    expect(result[0]).toHaveLength(66)
    expect(result[1]).toHaveLength(66)
  })

  it('deduplicates equivalent IDs after normalization', () => {
    const full = '0x' + '0'.repeat(63) + '1'
    const result = getTrustedPackageIds('0x1', full, '0x01')
    expect(result).toHaveLength(1)
  })

  it('skips null and undefined entries', () => {
    const result = getTrustedPackageIds(null, '0x1', undefined)
    expect(result).toHaveLength(1)
  })

  it('skips empty strings', () => {
    const result = getTrustedPackageIds('', '0x1', '  ')
    expect(result).toHaveLength(1)
  })

  it('returns empty array when called with no arguments', () => {
    expect(getTrustedPackageIds()).toEqual([])
  })

  it('throws for a malformed package ID', () => {
    expect(() => getTrustedPackageIds('not-hex')).toThrow(OnChainVerificationError)
  })
})

// ---------------------------------------------------------------------------
// getVendoredKioskPackageAddress
// ---------------------------------------------------------------------------

describe('getVendoredKioskPackageAddress', () => {
  const ENV_KEY = 'NEXT_PUBLIC_KIOSK_PACKAGE_ID'
  const NETWORK_KEY = 'NEXT_PUBLIC_SUI_NETWORK'

  beforeEach(() => {
    delete process.env[ENV_KEY]
    delete process.env[NETWORK_KEY]
  })

  it('returns a normalized address when env is set', () => {
    process.env[ENV_KEY] = '0xAA'
    const result = getVendoredKioskPackageAddress()
    expect(result).toHaveLength(66)
    expect(result).toMatch(/aa$/)
  })

  it('throws when env is not set and no network is configured', () => {
    expect(() => getVendoredKioskPackageAddress()).toThrow(/NEXT_PUBLIC_KIOSK_PACKAGE_ID must be set/)
  })

  it('throws when env contains an invalid address', () => {
    process.env[ENV_KEY] = 'garbage'
    expect(() => getVendoredKioskPackageAddress()).toThrow(/invalid kiosk package address/)
  })

  it('falls back to the testnet kiosk package when network=testnet and env is unset', () => {
    process.env[NETWORK_KEY] = 'testnet'
    expect(getVendoredKioskPackageAddress()).toBe(OFFICIAL_TESTNET_KIOSK_PACKAGE_ID)
  })

  it('falls back to the mainnet kiosk package when network=mainnet and env is unset', () => {
    process.env[NETWORK_KEY] = 'mainnet'
    expect(getVendoredKioskPackageAddress()).toBe(OFFICIAL_MAINNET_KIOSK_PACKAGE_ID)
  })

  it('env override takes precedence over network fallback', () => {
    process.env[NETWORK_KEY] = 'mainnet'
    process.env[ENV_KEY] = '0xAA'
    expect(getVendoredKioskPackageAddress()).toMatch(/aa$/)
  })

  it('resolves the official mainnet kiosk type origin for PersonalKioskCap filters', () => {
    process.env[ENV_KEY] = OFFICIAL_MAINNET_KIOSK_PACKAGE_ID
    expect(getVendoredKioskPackageAddress()).toBe(OFFICIAL_MAINNET_KIOSK_PACKAGE_ID)
    expect(OFFICIAL_MAINNET_PERSONAL_KIOSK_CAP_TYPE_PACKAGE_ID).toBe(
      '0x0cb4bcc0560340eb1a1b929cabe56b33fc6449820ec8c1980d69bb98b649b802',
    )
    expect(getPersonalKioskCapTypePackageAddress()).toBe(OFFICIAL_MAINNET_PERSONAL_KIOSK_CAP_TYPE_PACKAGE_ID)
  })

  it('resolves the mainnet PersonalKioskCap struct type via network fallback', async () => {
    process.env[NETWORK_KEY] = 'mainnet'
    const { getPersonalKioskCapStructType } = await import('@soulidity/sdk')
    expect(getPersonalKioskCapStructType()).toBe(
      `${OFFICIAL_MAINNET_PERSONAL_KIOSK_CAP_TYPE_PACKAGE_ID}::personal_kiosk::PersonalKioskCap`,
    )
  })
})

// ---------------------------------------------------------------------------
// ensureTransactionSucceeded
// ---------------------------------------------------------------------------

describe('ensureTransactionSucceeded', () => {
  it('does not throw for a successful transaction', () => {
    expect(() =>
      ensureTransactionSucceeded({ effects: { status: { status: 'success' } } }),
    ).not.toThrow()
  })

  it('throws for a failed transaction', () => {
    expect(() =>
      ensureTransactionSucceeded({ effects: { status: { status: 'failure' } } }),
    ).toThrow(OnChainVerificationError)
  })

  it('throws when effects are missing', () => {
    expect(() => ensureTransactionSucceeded({})).toThrow(OnChainVerificationError)
  })

  it('throws when status is null', () => {
    expect(() =>
      ensureTransactionSucceeded({ effects: { status: { status: null } } }),
    ).toThrow(OnChainVerificationError)
  })
})

// ---------------------------------------------------------------------------
// readTransactionSender
// ---------------------------------------------------------------------------

describe('readTransactionSender', () => {
  it('returns a normalized sender address', () => {
    const result = readTransactionSender({
      transaction: { data: { sender: '0x1' } },
    })
    expect(result).toBe('0x' + '0'.repeat(63) + '1')
  })

  it('returns null when transaction is null', () => {
    expect(readTransactionSender(null)).toBeNull()
  })

  it('returns null when transaction is undefined', () => {
    expect(readTransactionSender(undefined)).toBeNull()
  })

  it('returns null when sender is not a string', () => {
    expect(readTransactionSender({ transaction: { data: { sender: 123 } } })).toBeNull()
  })

  it('returns null when data is missing', () => {
    expect(readTransactionSender({ transaction: {} })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// quoteSoulPurchase
// ---------------------------------------------------------------------------

describe('quoteSoulPurchase', () => {
  const config = {
    objectId: '0x' + 'aa'.repeat(32),
    packageId: '0x' + 'bb'.repeat(32),
    feeRecipient: '0x' + 'cc'.repeat(32),
    platformFeeBps: 250, // 2.5%
    paused: false,
  }

  it('computes fees for a simple round price', () => {
    const result = quoteSoulPurchase(config, {
      priceAtomic: 10_000n, // 10000 base units
      creatorRoyaltyBps: 500, // 5%
      collectionRoyaltyBps: 100, // 1%
    })

    // platformFee = 10000 * 250 / 10000 = 250
    expect(result.platformFeeAtomic).toBe('250')
    // creatorRoyalty = 10000 * 500 / 10000 = 500
    expect(result.creatorRoyaltyAtomic).toBe('500')
    // collectionRoyalty = 10000 * 100 / 10000 = 100
    expect(result.collectionRoyaltyAtomic).toBe('100')
    // total = 10000 + 250 + 500 + 100 = 10850
    expect(result.totalAtomic).toBe('10850')
    expect(result.priceAtomic).toBe('10000')
  })

  it('returns zero fees when all bps are zero', () => {
    const zeroFeeConfig = { ...config, platformFeeBps: 0 }
    const result = quoteSoulPurchase(zeroFeeConfig, {
      priceAtomic: 1_000_000n,
      creatorRoyaltyBps: 0,
      collectionRoyaltyBps: 0,
    })

    expect(result.platformFeeAtomic).toBe('0')
    expect(result.creatorRoyaltyAtomic).toBe('0')
    expect(result.collectionRoyaltyAtomic).toBe('0')
    expect(result.totalAtomic).toBe('1000000')
  })

  it('returns all strings (not bigints)', () => {
    const result = quoteSoulPurchase(config, {
      priceAtomic: 100n,
      creatorRoyaltyBps: 100,
      collectionRoyaltyBps: 100,
    })
    expect(typeof result.priceAtomic).toBe('string')
    expect(typeof result.platformFeeAtomic).toBe('string')
    expect(typeof result.creatorRoyaltyAtomic).toBe('string')
    expect(typeof result.collectionRoyaltyAtomic).toBe('string')
    expect(typeof result.totalAtomic).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// quoteCollectionPurchase
// ---------------------------------------------------------------------------

describe('quoteCollectionPurchase', () => {
  const config = {
    objectId: '0x' + 'aa'.repeat(32),
    packageId: '0x' + 'bb'.repeat(32),
    feeRecipient: '0x' + 'cc'.repeat(32),
    platformFeeBps: 500, // 5%
    paused: false,
  }

  it('computes platform fee and total', () => {
    const result = quoteCollectionPurchase(config, { priceAtomic: 20_000n })
    // platformFee = 20000 * 500 / 10000 = 1000
    expect(result.platformFeeAtomic).toBe('1000')
    expect(result.priceAtomic).toBe('20000')
    expect(result.totalAtomic).toBe('21000')
  })

  it('returns zero fee when platformFeeBps is zero', () => {
    const zeroFeeConfig = { ...config, platformFeeBps: 0 }
    const result = quoteCollectionPurchase(zeroFeeConfig, { priceAtomic: 5000n })
    expect(result.platformFeeAtomic).toBe('0')
    expect(result.totalAtomic).toBe('5000')
  })

  it('handles a zero price', () => {
    const result = quoteCollectionPurchase(config, { priceAtomic: 0n })
    expect(result.platformFeeAtomic).toBe('0')
    expect(result.totalAtomic).toBe('0')
  })
})

// ---------------------------------------------------------------------------
// OnChainVerificationError
// ---------------------------------------------------------------------------

describe('OnChainVerificationError', () => {
  it('is an instance of Error', () => {
    const err = new OnChainVerificationError('test')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(OnChainVerificationError)
  })

  it('defaults status to 422', () => {
    expect(new OnChainVerificationError('msg').status).toBe(422)
  })

  it('allows a custom status', () => {
    expect(new OnChainVerificationError('msg', 400).status).toBe(400)
  })

  it('has the correct name', () => {
    expect(new OnChainVerificationError('msg').name).toBe('OnChainVerificationError')
  })
})
