import { describe, expect, it } from 'vitest'

import {
  getCreateCollectionFormState,
  getCreateCollectionRedirectHref,
} from '../../new-web/lib/collections/create-form-state'

describe('create collection form state', () => {
  it('marks required fields incomplete before submit', () => {
    expect(getCreateCollectionFormState({
      name: '',
      description: '',
      imageUrl: '',
      extraRoyaltyBps: 500,
      tradeable: true,
    })).toEqual({
      byteCounts: {
        name: 0,
        description: 0,
        imageUrl: 0,
      },
      fieldErrors: {
        name: 'Required',
        description: 'Required',
        imageUrl: 'Required',
        extraRoyaltyBps: null,
      },
      isComplete: false,
    })
  })

  it('rejects UTF-8 names over the 256-byte limit', () => {
    const state = getCreateCollectionFormState({
      name: '\u{1F600}'.repeat(65),
      description: 'Collection description',
      imageUrl: 'https://example.com/cover.png',
      extraRoyaltyBps: 500,
      tradeable: true,
    })

    expect(state.byteCounts.name).toBe(260)
    expect(state.fieldErrors.name).toBe('Must be 256 UTF-8 bytes or fewer')
    expect(state.isComplete).toBe(false)
  })

  it('rejects non-integer or out-of-range royalty values', () => {
    expect(getCreateCollectionFormState({
      name: 'Collection',
      description: 'Collection description',
      imageUrl: 'https://example.com/cover.png',
      extraRoyaltyBps: 2501,
      tradeable: true,
    }).fieldErrors.extraRoyaltyBps).toBe('Must be an integer from 0 to 2500')

    expect(getCreateCollectionFormState({
      name: 'Collection',
      description: 'Collection description',
      imageUrl: 'https://example.com/cover.png',
      extraRoyaltyBps: 12.5,
      tradeable: true,
    }).fieldErrors.extraRoyaltyBps).toBe('Must be an integer from 0 to 2500')
  })

  it('accepts a complete valid form at the boundary', () => {
    expect(getCreateCollectionFormState({
      name: 'Collection',
      description: 'Collection description',
      imageUrl: 'https://example.com/cover.png',
      extraRoyaltyBps: 2500,
      tradeable: false,
    })).toEqual({
      byteCounts: {
        name: 10,
        description: 22,
        imageUrl: 29,
      },
      fieldErrors: {
        name: null,
        description: null,
        imageUrl: null,
        extraRoyaltyBps: null,
      },
      isComplete: true,
    })
  })
})

describe('getCreateCollectionRedirectHref', () => {
  it('builds the collection detail route from collectionOnChainId', () => {
    expect(getCreateCollectionRedirectHref({
      collectionOnChainId: '0xabc/123',
    })).toBe('/collections/0xabc%2F123')
  })
})
