import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Hoisted mock helpers ────────────────────────────────────────────────
// queries.ts creates a SuiClient at module level which blows up without
// env vars, so we must mock the whole module. The functions events.ts
// depends on are pure — we reimplement them faithfully here.

const mockedNormalizeSuiValue = vi.hoisted(
  () =>
    (value: string): string | null => {
      const trimmed = value.trim()
      if (!trimmed.startsWith('0x')) return null
      const hex = trimmed.slice(2).toLowerCase()
      if (!/^[0-9a-f]+$/.test(hex)) return null
      return '0x' + hex.padStart(64, '0')
    },
)

const mockedScopeMaskToScopes = vi.hoisted(
  () =>
    (mask: number): string[] => {
      const scopes: string[] = []
      if ((mask & 1) === 1) scopes.push('seal')
      if ((mask & 2) === 2) scopes.push('memory')
      if ((mask & 4) === 4) scopes.push('skills')
      return scopes
    },
)

vi.mock('@/lib/soulidity/queries', () => ({
  normalizeSuiValue: mockedNormalizeSuiValue,
  scopeMaskToScopes: mockedScopeMaskToScopes,
  getTrustedPackageIds: (...ids: Array<string | null | undefined>) =>
    ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((id) => mockedNormalizeSuiValue(id)!),
  OnChainVerificationError: class OnChainVerificationError extends Error {
    readonly status: number
    constructor(message: string, status = 422) {
      super(message)
      this.name = 'OnChainVerificationError'
      this.status = status
    }
  },
}))

// ── Imports (after mocks) ───────────────────────────────────────────────
import {
  extractSoulMintedToKioskEvent,
  extractSoulListedEvent,
  extractSoulPurchasedEvent,
  extractSoulListingCancelledEvent,
  extractSoulGrantIssuedEvent,
  extractSoulGrantRevokedEvent,
  extractMemoryEntryAppendedEvent,
  extractSkillVersionAppendedEvent,
  tryExtractSkillVersionAppendedEvent,
  extractSkillVersionDeletedEvent,
  extractSoulAddedToCollectionEvent,
  extractSoulCollectionCreatedEvent,
  isGrantActive,
} from '../../web/lib/soulidity/events'

// ── Test constants ──────────────────────────────────────────────────────
const PKG = '0x' + 'aa'.repeat(32) // 0xaaaa…aa (64 hex chars)
const NORM_PKG = '0x' + 'aa'.repeat(32) // already normalised

const addr = (digit: string) => '0x' + digit.repeat(64)

// ── Helpers ─────────────────────────────────────────────────────────────
function makeTx(type: string, parsedJson: Record<string, unknown>) {
  return { events: [{ type, parsedJson }] }
}

function makeEmptyTx() {
  return { events: [] }
}

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────

describe('extractSoulMintedToKioskEvent', () => {
  const eventType = `${PKG}::market::SoulMintedToKiosk`

  it('extracts fields from a valid event', () => {
    const tx = makeTx(eventType, {
      soul_id: addr('1'),
      state_id: addr('2'),
      memory_id: addr('3'),
      metadata_id: addr('6'),
      kiosk_id: addr('4'),
      owner: addr('5'),
      provenance_kind: 0,
    })
    const result = extractSoulMintedToKioskEvent(tx, PKG)
    expect(result).toEqual({
      soulId: addr('1'),
      stateId: addr('2'),
      memoryId: addr('3'),
      metadataId: addr('6'),
      kioskId: addr('4'),
      ownerAddress: addr('5'),
      provenanceKind: 0,
    })
  })

  it('handles object-style IDs ({ id: "0x..." })', () => {
    const tx = makeTx(eventType, {
      soul_id: { id: addr('1') },
      state_id: { id: addr('2') },
      memory_id: { id: addr('3') },
      metadata_id: { id: addr('6') },
      kiosk_id: { id: addr('4') },
      owner: addr('5'),
      provenance_kind: '1',
    })
    const result = extractSoulMintedToKioskEvent(tx, PKG)
    expect(result.soulId).toBe(addr('1'))
    expect(result.metadataId).toBe(addr('6'))
    expect(result.provenanceKind).toBe(1)
  })

  it('throws when event is missing', () => {
    expect(() => extractSoulMintedToKioskEvent(makeEmptyTx(), PKG)).toThrow(
      'SoulMintedToKiosk event is missing from the transaction',
    )
  })

  it('throws on malformed address', () => {
    const tx = makeTx(eventType, {
      soul_id: addr('1'),
      state_id: addr('2'),
      memory_id: addr('3'),
      kiosk_id: addr('4'),
      owner: 'not-a-valid-address',
      provenance_kind: 0,
    })
    expect(() => extractSoulMintedToKioskEvent(tx, PKG)).toThrow('malformed')
  })
})

describe('extractSoulListedEvent', () => {
  const eventType = `${PKG}::market::SoulListed`

  it('extracts fields from a valid event', () => {
    const tx = makeTx(eventType, {
      listing_id: addr('a'),
      soul_id: addr('b'),
      seller: addr('c'),
      kiosk_id: addr('d'),
      price: '1000000000',
    })
    const result = extractSoulListedEvent(tx, PKG)
    expect(result).toEqual({
      listingId: addr('a'),
      soulId: addr('b'),
      sellerAddress: addr('c'),
      kioskId: addr('d'),
      priceAtomic: BigInt('1000000000'),
    })
  })

  it('accepts numeric price', () => {
    const tx = makeTx(eventType, {
      listing_id: addr('a'),
      soul_id: addr('b'),
      seller: addr('c'),
      kiosk_id: addr('d'),
      price: 500,
    })
    expect(extractSoulListedEvent(tx, PKG).priceAtomic).toBe(500n)
  })

  it('throws when event is missing', () => {
    expect(() => extractSoulListedEvent(makeEmptyTx(), PKG)).toThrow(
      'SoulListed event is missing',
    )
  })
})

describe('extractSoulPurchasedEvent', () => {
  const eventType = `${PKG}::market::SoulPurchased`

  it('extracts all fee fields from a valid event', () => {
    const tx = makeTx(eventType, {
      listing_id: addr('a'),
      soul_id: addr('b'),
      seller: addr('c'),
      buyer: addr('d'),
      price: '2000000000',
      platform_fee: '100000000',
      creator_royalty: '50000000',
      collection_royalty: '25000000',
    })
    const result = extractSoulPurchasedEvent(tx, PKG)
    expect(result).toEqual({
      listingId: addr('a'),
      soulId: addr('b'),
      sellerAddress: addr('c'),
      buyerAddress: addr('d'),
      priceAtomic: 2000000000n,
      platformFeeAtomic: 100000000n,
      creatorRoyaltyAtomic: 50000000n,
      collectionRoyaltyAtomic: 25000000n,
    })
  })

  it('throws when event is missing', () => {
    expect(() => extractSoulPurchasedEvent(makeEmptyTx(), PKG)).toThrow(
      'SoulPurchased event is missing',
    )
  })
})

describe('extractSoulListingCancelledEvent', () => {
  const eventType = `${PKG}::market::SoulListingCancelled`

  it('extracts fields from a valid event', () => {
    const tx = makeTx(eventType, {
      listing_id: addr('a'),
      soul_id: addr('b'),
      seller: addr('c'),
    })
    expect(extractSoulListingCancelledEvent(tx, PKG)).toEqual({
      listingId: addr('a'),
      soulId: addr('b'),
      sellerAddress: addr('c'),
    })
  })

  it('throws when event is missing', () => {
    expect(() => extractSoulListingCancelledEvent(makeEmptyTx(), PKG)).toThrow(
      'SoulListingCancelled event is missing',
    )
  })
})

describe('extractSoulGrantIssuedEvent', () => {
  const eventType = `${PKG}::grant::SoulGrantIssued`

  it('extracts grant with scopes and expiry', () => {
    const tx = makeTx(eventType, {
      grant_id: addr('a'),
      soul_id: addr('b'),
      issued_by: addr('c'),
      grantee: addr('d'),
      scope_mask: 7,
      expires_at_ms: '1700000000000',
    })
    const result = extractSoulGrantIssuedEvent(tx, PKG)
    expect(result).toEqual({
      grantId: addr('a'),
      soulId: addr('b'),
      issuedByAddress: addr('c'),
      granteeAddress: addr('d'),
      scopeMask: 7,
      scopes: ['seal', 'memory', 'skills'],
      expiresAtMs: 1700000000000,
    })
  })

  it('returns null expiresAtMs when not provided', () => {
    const tx = makeTx(eventType, {
      grant_id: addr('a'),
      soul_id: addr('b'),
      issued_by: addr('c'),
      grantee: addr('d'),
      scope_mask: 1,
      expires_at_ms: null,
    })
    const result = extractSoulGrantIssuedEvent(tx, PKG)
    expect(result.expiresAtMs).toBeNull()
    expect(result.scopes).toEqual(['seal'])
  })

  it('handles scope_mask=3 (seal + memory)', () => {
    const tx = makeTx(eventType, {
      grant_id: addr('a'),
      soul_id: addr('b'),
      issued_by: addr('c'),
      grantee: addr('d'),
      scope_mask: 3,
      expires_at_ms: null,
    })
    expect(extractSoulGrantIssuedEvent(tx, PKG).scopes).toEqual(['seal', 'memory'])
  })

  it('throws when event is missing', () => {
    expect(() => extractSoulGrantIssuedEvent(makeEmptyTx(), PKG)).toThrow(
      'SoulGrantIssued event is missing',
    )
  })
})

describe('extractSoulGrantRevokedEvent', () => {
  const eventType = `${PKG}::grant::SoulGrantRevoked`

  it('extracts fields from a valid event', () => {
    const tx = makeTx(eventType, {
      grant_id: addr('a'),
      soul_id: addr('b'),
      revoked_by: addr('c'),
      grantee: addr('d'),
    })
    expect(extractSoulGrantRevokedEvent(tx, PKG)).toEqual({
      grantId: addr('a'),
      soulId: addr('b'),
      revokedByAddress: addr('c'),
      granteeAddress: addr('d'),
    })
  })

  it('throws when event is missing', () => {
    expect(() => extractSoulGrantRevokedEvent(makeEmptyTx(), PKG)).toThrow(
      'SoulGrantRevoked event is missing',
    )
  })
})

describe('extractMemoryEntryAppendedEvent', () => {
  const eventType = `${PKG}::memory::MemoryEntryAppended`

  it('extracts fields from a valid event', () => {
    const tx = makeTx(eventType, {
      memory_id: addr('1'),
      soul_id: addr('3'),
      timestamp_key: '1718452800000',
      writer: addr('4'),
      writer_kind: 1,
      created_at_ms: '1718452800000',
      blob_object_id: addr('5'),
    })
    expect(extractMemoryEntryAppendedEvent(tx, PKG)).toEqual({
      memoryId: addr('1'),
      soulId: addr('3'),
      timestampKey: 1718452800000,
      writerAddress: addr('4'),
      writerKind: 1,
      createdAtMs: 1718452800000,
      blobObjectId: addr('5'),
    })
  })

  it('handles object-style blob_object_id and numeric timestamp values', () => {
    const tx = makeTx(eventType, {
      memory_id: addr('1'),
      soul_id: addr('3'),
      timestamp_key: 123,
      writer: addr('4'),
      writer_kind: 2,
      created_at_ms: 1700000000000,
      blob_object_id: { id: addr('5') },
    })
    const result = extractMemoryEntryAppendedEvent(tx, PKG)
    expect(result.blobObjectId).toBe(addr('5'))
    expect(result.timestampKey).toBe(123)
  })

  it('throws when event is missing', () => {
    expect(() => extractMemoryEntryAppendedEvent(makeEmptyTx(), PKG)).toThrow(
      'MemoryEntryAppended event is missing',
    )
  })
})

describe('extractSkillVersionAppendedEvent', () => {
  const eventType = `${PKG}::skills::SkillVersionAppended`

  it('extracts a public skill slot', () => {
    const tx = makeTx(eventType, {
      skills_id: addr('1'),
      soul_id: addr('2'),
      skill_name: 'reporter',
      version_index: 2,
      is_public: true,
      created_at_ms: '1700000000000',
      blob_object_id: addr('3'),
    })
    expect(extractSkillVersionAppendedEvent(tx, PKG)).toEqual({
      skillsId: addr('1'),
      soulId: addr('2'),
      skillName: 'reporter',
      versionIndex: 2,
      visibility: 'public',
      createdAtMs: 1700000000000,
      blobObjectId: addr('3'),
    })
  })

  it('extracts a private skill slot', () => {
    const tx = makeTx(eventType, {
      skills_id: addr('1'),
      soul_id: addr('2'),
      skill_name: 'planner',
      version_index: '0',
      is_public: false,
      created_at_ms: '1700000000000',
      blob_object_id: addr('3'),
    })
    const result = extractSkillVersionAppendedEvent(tx, PKG)
    expect(result.visibility).toBe('private')
    expect(result.skillName).toBe('planner')
    expect(result.versionIndex).toBe(0)
  })

  it('throws when event is missing', () => {
    expect(() => extractSkillVersionAppendedEvent(makeEmptyTx(), PKG)).toThrow(
      'SkillVersionAppended event is missing',
    )
  })
})

describe('tryExtractSkillVersionAppendedEvent', () => {
  const eventType = `${PKG}::skills::SkillVersionAppended`

  it('returns parsed event when present', () => {
    const tx = makeTx(eventType, {
      skills_id: addr('1'),
      soul_id: addr('2'),
      skill_name: 'reporter',
      version_index: 0,
      is_public: true,
      created_at_ms: '1700000000000',
      blob_object_id: addr('3'),
    })
    expect(tryExtractSkillVersionAppendedEvent(tx, PKG)).toEqual({
      skillsId: addr('1'),
      soulId: addr('2'),
      skillName: 'reporter',
      versionIndex: 0,
      visibility: 'public',
      createdAtMs: 1700000000000,
      blobObjectId: addr('3'),
    })
  })

  it('returns null when event is missing', () => {
    expect(tryExtractSkillVersionAppendedEvent(makeEmptyTx(), PKG)).toBeNull()
  })
})

describe('extractSkillVersionDeletedEvent', () => {
  const eventType = `${PKG}::skills::SkillVersionDeleted`

  it('extracts composite skill coordinates from a delete event', () => {
    const tx = makeTx(eventType, {
      skills_id: addr('1'),
      soul_id: addr('2'),
      skill_name: 'planner',
      version_index: 4,
      deleted_by: addr('3'),
    })

    expect(extractSkillVersionDeletedEvent(tx, PKG)).toEqual({
      skillsId: addr('1'),
      soulId: addr('2'),
      skillName: 'planner',
      versionIndex: 4,
      deletedByAddress: addr('3'),
    })
  })
})

describe('isGrantActive', () => {
  const grantId = addr('a')
  const soulId = addr('b')
  const granteeAddr = addr('c')
  const issuedByAddr = addr('d')

  function makeGrant(overrides: Partial<Parameters<typeof isGrantActive>[0]['grant'] & {}> = {}) {
    return {
      objectId: grantId,
      packageId: NORM_PKG,
      soulId,
      granteeAddress: granteeAddr,
      issuedByAddress: issuedByAddr,
      ownershipEpochSnapshot: 1,
      scopeMask: 7,
      scopes: ['seal', 'memory', 'skills'] as const,
      expiresAtMs: null,
      ...overrides,
    }
  }

  function makeState(overrides: Partial<Parameters<typeof isGrantActive>[0]['state']> = {}) {
    return {
      ownershipEpoch: 1,
      activeGrants: [
        {
          grantId,
          granteeAddress: granteeAddr,
          scopeMask: 7,
          expiresAtMs: null,
        },
      ],
      ...overrides,
    }
  }

  it('returns true for an active grant with matching epoch and slot', () => {
    expect(
      isGrantActive({
        state: makeState(),
        grant: makeGrant(),
        nowMs: Date.now(),
      }),
    ).toBe(true)
  })

  it('returns false when grant is null', () => {
    expect(
      isGrantActive({
        state: makeState(),
        grant: null,
        nowMs: Date.now(),
      }),
    ).toBe(false)
  })

  it('returns false when ownership epoch does not match', () => {
    expect(
      isGrantActive({
        state: makeState({ ownershipEpoch: 2 }),
        grant: makeGrant({ ownershipEpochSnapshot: 1 }),
        nowMs: Date.now(),
      }),
    ).toBe(false)
  })

  it('returns false when grant is not in activeGrants', () => {
    expect(
      isGrantActive({
        state: makeState({ activeGrants: [] }),
        grant: makeGrant(),
        nowMs: Date.now(),
      }),
    ).toBe(false)
  })

  it('returns false when grantee address mismatch between grant and slot', () => {
    expect(
      isGrantActive({
        state: makeState({
          activeGrants: [
            { grantId, granteeAddress: addr('f'), scopeMask: 7, expiresAtMs: null },
          ],
        }),
        grant: makeGrant(),
        nowMs: Date.now(),
      }),
    ).toBe(false)
  })

  it('returns false when grant has expired', () => {
    const pastMs = Date.now() - 60_000
    expect(
      isGrantActive({
        state: makeState(),
        grant: makeGrant({ expiresAtMs: pastMs }),
        nowMs: Date.now(),
      }),
    ).toBe(false)
  })

  it('returns true when grant has not yet expired', () => {
    const futureMs = Date.now() + 3_600_000
    expect(
      isGrantActive({
        state: makeState(),
        grant: makeGrant({ expiresAtMs: futureMs }),
        nowMs: Date.now(),
      }),
    ).toBe(true)
  })

  it('returns false when required scope is not in grant scopes', () => {
    expect(
      isGrantActive({
        state: makeState(),
        grant: makeGrant({ scopes: ['seal'] }),
        nowMs: Date.now(),
        requiredScope: 'memory',
      }),
    ).toBe(false)
  })

  it('returns true when required scope is present', () => {
    expect(
      isGrantActive({
        state: makeState(),
        grant: makeGrant({ scopes: ['seal', 'memory'] }),
        nowMs: Date.now(),
        requiredScope: 'memory',
      }),
    ).toBe(true)
  })
})

describe('trusted package fallback', () => {
  it('matches event from a different package when listed in trustedPackageIds', () => {
    const altPkg = '0x' + 'bb'.repeat(32)
    const tx = {
      events: [
        {
          type: `${altPkg}::market::SoulListed`,
          parsedJson: {
            listing_id: addr('a'),
            soul_id: addr('b'),
            seller: addr('c'),
            kiosk_id: addr('d'),
            price: '1000',
          },
        },
      ],
    }
    // Primary package won't match, but altPkg is in trustedPackageIds
    const result = extractSoulListedEvent(tx, PKG, [altPkg])
    expect(result.listingId).toBe(addr('a'))
    expect(result.priceAtomic).toBe(1000n)
  })
})

describe('edge cases', () => {
  it('OnChainVerificationError has name and default status', () => {
    const eventType = `${PKG}::market::SoulMintedToKiosk`
    try {
      extractSoulMintedToKioskEvent(makeEmptyTx(), PKG)
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).name).toBe('OnChainVerificationError')
    }
  })

  it('handles transactions with null events array', () => {
    expect(() => extractSoulMintedToKioskEvent({ events: null }, PKG)).toThrow(
      'SoulMintedToKiosk event is missing',
    )
  })

  it('handles transactions with undefined events', () => {
    expect(() => extractSoulMintedToKioskEvent({}, PKG)).toThrow(
      'SoulMintedToKiosk event is missing',
    )
  })
})

describe('extractSoulAddedToCollectionEvent', () => {
  const eventType = `${PKG}::collection::SoulAddedToCollection`

  it('parses currentSupply / maxSupply on a capped collection', () => {
    const tx = makeTx(eventType, {
      collection_id: addr('1'),
      soul_id: addr('2'),
      current_supply: '3',
      max_supply: ['10'],
    })
    const result = extractSoulAddedToCollectionEvent(tx, PKG)
    expect(result.currentSupply).toBe(3n)
    expect(result.maxSupply).toBe(10n)
  })

  it('parses Some(0) without confusing it with None (truthy bug regression)', () => {
    const tx = makeTx(eventType, {
      collection_id: addr('1'),
      soul_id: addr('2'),
      current_supply: '1',
      max_supply: { vec: ['0'] },
    })
    const result = extractSoulAddedToCollectionEvent(tx, PKG)
    expect(result.maxSupply).toBe(0n)
  })

  it('treats empty vec as null (None)', () => {
    const tx = makeTx(eventType, {
      collection_id: addr('1'),
      soul_id: addr('2'),
      current_supply: '5',
      max_supply: { vec: [] },
    })
    const result = extractSoulAddedToCollectionEvent(tx, PKG)
    expect(result.maxSupply).toBeNull()
  })

  it('treats null max_supply as null', () => {
    const tx = makeTx(eventType, {
      collection_id: addr('1'),
      soul_id: addr('2'),
      current_supply: 0,
      max_supply: null,
    })
    const result = extractSoulAddedToCollectionEvent(tx, PKG)
    expect(result.currentSupply).toBe(0n)
    expect(result.maxSupply).toBeNull()
  })
})

describe('extractSoulCollectionCreatedEvent', () => {
  const eventType = `${PKG}::collection::SoulCollectionCreated`

  it('parses the maxSupply Some branch', () => {
    const tx = makeTx(eventType, {
      collection_id: addr('1'),
      right_id: addr('2'),
      creator: addr('3'),
      current_holder: addr('3'),
      tradeable: true,
      max_supply: ['7'],
    })
    const result = extractSoulCollectionCreatedEvent(tx, PKG)
    expect(result.collectionId).toBe(addr('1'))
    expect(result.tradeable).toBe(true)
    expect(result.maxSupply).toBe(7n)
  })

  it('parses Some(0) and None distinctly', () => {
    const someZeroTx = makeTx(eventType, {
      collection_id: addr('1'),
      right_id: addr('2'),
      creator: addr('3'),
      current_holder: addr('3'),
      tradeable: false,
      max_supply: { vec: ['0'] },
    })
    expect(extractSoulCollectionCreatedEvent(someZeroTx, PKG).maxSupply).toBe(0n)

    const noneTx = makeTx(eventType, {
      collection_id: addr('1'),
      right_id: addr('2'),
      creator: addr('3'),
      current_holder: addr('3'),
      tradeable: false,
      max_supply: { vec: [] },
    })
    expect(extractSoulCollectionCreatedEvent(noneTx, PKG).maxSupply).toBeNull()
  })

  it('throws when the event is missing', () => {
    expect(() => extractSoulCollectionCreatedEvent(makeEmptyTx(), PKG)).toThrow(
      'SoulCollectionCreated event is missing',
    )
  })
})
