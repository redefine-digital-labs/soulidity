import { describe, expect, it } from 'vitest'
import {
  COLLECTION_ERROR_CATALOG,
  MARKET_ERROR_CATALOG,
  assertSoulidityTxSucceeded,
  enhanceCollectionError,
  enhanceMarketError,
  enhanceSoulidityError,
  formatCollectionAbortMessage,
  formatMarketAbortMessage,
  getCollectionAbortInfo,
  getMarketAbortInfo,
  parseCollectionAbort,
  parseMarketAbort,
} from '../../web/lib/soulidity/market-errors'

describe('market error catalog', () => {
  it('covers every active error code on market.move', () => {
    const expected = [
      ...Array.from({ length: 17 }, (_, i) => i), // 0..16
      19,
      25,
      28,
      29,
      30,
      31,
      32,
      33,
      35,
      ...Array.from({ length: 15 }, (_, i) => i + 37), // 37..51
    ]
    for (const code of expected) {
      expect(MARKET_ERROR_CATALOG[code], `missing entry for code ${code}`).toBeDefined()
      expect(MARKET_ERROR_CATALOG[code]!.summary.length).toBeGreaterThan(0)
    }
  })

  it('leaves removed or reserved codes unmapped', () => {
    expect(MARKET_ERROR_CATALOG[17]).toBeUndefined()
    for (const code of [18, 20, 21, 22, 23, 24, 26, 27, 34, 36]) {
      expect(MARKET_ERROR_CATALOG[code], `unexpected entry for code ${code}`).toBeUndefined()
    }
  })

  it('uses each error name exactly once', () => {
    const names = Object.values(MARKET_ERROR_CATALOG).map((entry) => entry.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps the four split target codes mapped to their narrowed semantics', () => {
    expect(MARKET_ERROR_CATALOG[14]?.name).toBe('EPersonalKioskMismatch')
    expect(MARKET_ERROR_CATALOG[8]?.name).toBe('EUnauthorizedKioskAccess')
    expect(MARKET_ERROR_CATALOG[4]?.name).toBe('EListingKioskMismatch')
    expect(MARKET_ERROR_CATALOG[19]?.name).toBe('EAccessListStateMismatch')
  })

  it('exposes the six newly-split codes with distinct semantics', () => {
    expect(MARKET_ERROR_CATALOG[37]?.name).toBe('EPersonalKioskCapMismatch')
    expect(MARKET_ERROR_CATALOG[38]?.name).toBe('ESoulCurrentKioskMismatch')
    expect(MARKET_ERROR_CATALOG[39]?.name).toBe('ESoulOwnerMismatch')
    expect(MARKET_ERROR_CATALOG[40]?.name).toBe('EKioskOwnerMismatch')
    expect(MARKET_ERROR_CATALOG[41]?.name).toBe('EListingSellerMismatch')
    expect(MARKET_ERROR_CATALOG[42]?.name).toBe('EListingStateMismatch')
  })
})

describe('parseMarketAbort', () => {
  it('parses dapp-kit short-form abort messages and identifies market module', () => {
    const message =
      "Transaction resolution failed: MoveAbort in 3rd command, abort code: 14, in '0x994eeb7f0a9b4519feb2a1346ca4786e4bf8435b706a7fc2b1a4eb2fbbc9db2f::market::insert_or_assert_personal_kiosk_registration' (instruction 23)"
    const info = parseMarketAbort(new Error(message))

    expect(info).not.toBeNull()
    expect(info!.code).toBe(14)
    expect(info!.module).toBe('market')
    expect(info!.functionName).toBe('insert_or_assert_personal_kiosk_registration')
    expect(info!.entry.name).toBe('EPersonalKioskMismatch')
  })

  it('parses the full SDK MoveAbort/MoveLocation form', () => {
    const message =
      'MoveAbort(MoveLocation { module: ModuleId { address: 0x99..ab, name: Identifier("market") }, function: 12, instruction: 7, function_name: Some("buy_soul_fixed_price") }, 8) in command 2'
    const info = parseMarketAbort(message)

    expect(info).not.toBeNull()
    expect(info!.code).toBe(8)
    expect(info!.functionName).toBe('buy_soul_fixed_price')
    expect(info!.entry.name).toBe('EUnauthorizedKioskAccess')
  })

  it('returns null for non-market aborts', () => {
    const message =
      "Transaction resolution failed: MoveAbort in 1st command, abort code: 5, in '0xab::soul::set_owner' (instruction 4)"
    expect(parseMarketAbort(new Error(message))).toBeNull()
  })

  it('returns null for unrelated errors', () => {
    expect(parseMarketAbort(new Error('Network request failed'))).toBeNull()
    expect(parseMarketAbort('not an error object')).toBeNull()
    expect(parseMarketAbort(null)).toBeNull()
    expect(parseMarketAbort(undefined)).toBeNull()
  })

  it('returns null for market aborts with unknown codes', () => {
    const message =
      "Transaction resolution failed: MoveAbort in 1st command, abort code: 999, in '0xab::market::list_soul_fixed_price' (instruction 1)"
    expect(parseMarketAbort(new Error(message))).toBeNull()
  })

  it('handles errors that expose `message` without being Error instances', () => {
    const info = parseMarketAbort({
      message:
        "Transaction resolution failed: MoveAbort in 2nd command, abort code: 37, in '0xab::market::ensure_personal_kiosk_registered' (instruction 12)",
    })
    expect(info?.code).toBe(37)
    expect(info?.entry.name).toBe('EPersonalKioskCapMismatch')
  })
})

describe('formatMarketAbortMessage', () => {
  it('combines summary, name, code, and recovery hint into one line', () => {
    const info = parseMarketAbort(
      new Error(
        "Transaction resolution failed: MoveAbort in 3rd command, abort code: 38, in '0xab::market::list_soul_fixed_price' (instruction 7)",
      ),
    )!
    const formatted = formatMarketAbortMessage(info)

    expect(formatted).toContain('ESoulCurrentKioskMismatch')
    expect(formatted).toContain('code 38')
    expect(formatted).toContain('Refresh the page')
  })
})

describe('enhanceMarketError', () => {
  it('rewraps market aborts into a SoulidityMarketAbortError with a structured message', () => {
    const original = new Error(
      "Transaction resolution failed: MoveAbort in 1st command, abort code: 14, in '0xab::market::insert_or_assert_personal_kiosk_registration' (instruction 23)",
    )
    const wrapped = enhanceMarketError(original) as Error & { marketAbort?: { code: number } }

    expect(wrapped).toBeInstanceOf(Error)
    expect(wrapped).not.toBe(original)
    expect(wrapped.name).toBe('SoulidityMarketAbortError')
    expect(wrapped.message).toContain('EPersonalKioskMismatch')
    expect(wrapped.message).toContain('code 14')
    expect(wrapped.cause).toBe(original)
    expect(wrapped.marketAbort?.code).toBe(14)
  })

  it('passes non-market errors through untouched', () => {
    const original = new Error('Wallet rejected the transaction')
    expect(enhanceMarketError(original)).toBe(original)
  })

  it('passes unknown-code aborts through untouched', () => {
    const original = new Error(
      "MoveAbort in 1st command, abort code: 999, in '0xab::market::buy_soul_fixed_price' (instruction 1)",
    )
    expect(enhanceMarketError(original)).toBe(original)
  })
})

describe('assertSoulidityTxSucceeded', () => {
  it('enhances market aborts carried by failed transaction effects', () => {
    expect(() => assertSoulidityTxSucceeded({
      digest: '9YsFailedDigest',
      effects: {
        status: {
          status: 'failure',
          error:
            "Transaction resolution failed: MoveAbort in 2nd command, abort code: 37, in '0xab::market::ensure_personal_kiosk_registered' (instruction 12)",
        },
      },
    }, 'Soul mint transaction')).toThrow('EPersonalKioskCapMismatch')

    try {
      assertSoulidityTxSucceeded({
        digest: '9YsFailedDigest',
        effects: {
          status: {
            status: 'failure',
            error:
              "Transaction resolution failed: MoveAbort in 2nd command, abort code: 37, in '0xab::market::ensure_personal_kiosk_registered' (instruction 12)",
          },
        },
      }, 'Soul mint transaction')
    } catch (error) {
      const wrapped = error as Error & { marketAbort?: { code: number }; cause?: Error }
      expect(wrapped.name).toBe('SoulidityMarketAbortError')
      expect(wrapped.marketAbort?.code).toBe(37)
      expect(wrapped.cause?.name).toBe('SuiTxExecutionError')
    }
  })

  it('enhances collection aborts carried by failed transaction effects', () => {
    expect(() => assertSoulidityTxSucceeded({
      digest: '9YsFailedCollectionDigest',
      effects: {
        status: {
          status: 'failure',
          error:
            "Transaction resolution failed: MoveAbort in 1st command, abort code: 4, in '0xab::collection::add_soul' (instruction 7)",
        },
      },
    }, 'Collection bind transaction')).toThrow('ECollectionSupplyExceeded')

    try {
      assertSoulidityTxSucceeded({
        digest: '9YsFailedCollectionDigest',
        effects: {
          status: {
            status: 'failure',
            error:
              "Transaction resolution failed: MoveAbort in 1st command, abort code: 4, in '0xab::collection::add_soul' (instruction 7)",
          },
        },
      }, 'Collection bind transaction')
    } catch (error) {
      const wrapped = error as Error & { collectionAbort?: { code: number }; cause?: Error }
      expect(wrapped.name).toBe('SoulidityCollectionAbortError')
      expect(wrapped.collectionAbort?.code).toBe(4)
      expect(wrapped.cause?.name).toBe('SuiTxExecutionError')
    }
  })
})

describe('getMarketAbortInfo', () => {
  it('reads enhanced market abort metadata for paid-access retry decisions', () => {
    const original = new Error(
      "Transaction resolution failed: MoveAbort in 1st command, abort code: 35, in '0xab::market::purchase_paid_access' (instruction 9)",
    )
    const enhanced = enhanceMarketError(original)
    const info = getMarketAbortInfo(enhanced)

    expect(info?.code).toBe(35)
    expect(info?.entry.name).toBe('EPaidAccessOwnerCannotPurchase')
    expect(info?.functionName).toBe('purchase_paid_access')
  })

  it('falls back through an error cause when wrapper metadata is absent', () => {
    const cause = new Error(
      "Transaction resolution failed: MoveAbort in 2nd command, abort code: 51, in '0xab::market::purchase_paid_access' (instruction 11)",
    )
    const wrapper = new Error('wallet wrapper', { cause })

    expect(getMarketAbortInfo(wrapper)?.entry.name).toBe('EPaidAccessKindMismatch')
  })
})

describe('collection error catalog + abort parser', () => {
  it('covers all collection.move codes 0..6', () => {
    for (const code of [0, 1, 2, 3, 4, 5, 6]) {
      expect(COLLECTION_ERROR_CATALOG[code], `missing entry for code ${code}`).toBeDefined()
    }
    expect(COLLECTION_ERROR_CATALOG[7]).toBeUndefined()
  })

  it('maps ECollectionSupplyExceeded (4) to HTTP 409', () => {
    expect(COLLECTION_ERROR_CATALOG[4]?.name).toBe('ECollectionSupplyExceeded')
    expect(COLLECTION_ERROR_CATALOG[4]?.httpStatus).toBe(409)
  })

  it('maps ESupplyCapInvalid (5) to HTTP 400', () => {
    expect(COLLECTION_ERROR_CATALOG[5]?.name).toBe('ESupplyCapInvalid')
    expect(COLLECTION_ERROR_CATALOG[5]?.httpStatus).toBe(400)
  })

  it('maps ESoulCurrentlyListed (6) to HTTP 409', () => {
    expect(COLLECTION_ERROR_CATALOG[6]?.name).toBe('ESoulCurrentlyListed')
    expect(COLLECTION_ERROR_CATALOG[6]?.httpStatus).toBe(409)
  })

  it('parseCollectionAbort identifies the collection module from short-form messages', () => {
    const raw =
      "Transaction resolution failed: MoveAbort in 1st command, abort code: 4, in '0xab::collection::add_soul' (instruction 7)"
    const info = parseCollectionAbort(new Error(raw))
    expect(info?.module).toBe('collection')
    expect(info?.code).toBe(4)
    expect(info?.entry.name).toBe('ECollectionSupplyExceeded')
    expect(info?.functionName).toBe('add_soul')
  })

  it('parseCollectionAbort identifies the collection module from full SDK messages', () => {
    const raw = `Error: MoveAbort(MoveLocation { module: ModuleId { address: ${'0x' + 'ab'.repeat(32)}, name: Identifier("collection") }, function: 1, instruction: 4, function_name: Some("create") }, 5)`
    const info = parseCollectionAbort(new Error(raw))
    expect(info?.module).toBe('collection')
    expect(info?.code).toBe(5)
    expect(info?.entry.name).toBe('ESupplyCapInvalid')
  })

  it('returns null for market aborts (clean separation)', () => {
    const raw =
      "Transaction resolution failed: MoveAbort in 1st command, abort code: 4, in '0xab::market::buy_soul' (instruction 9)"
    expect(parseCollectionAbort(new Error(raw))).toBeNull()
  })

  it('formatCollectionAbortMessage carries the recovery hint', () => {
    const info = parseCollectionAbort(
      new Error("MoveAbort in 1st, abort code: 4, in '0xab::collection::add_soul'"),
    )!
    expect(formatCollectionAbortMessage(info)).toContain('Collection at maximum capacity')
    expect(formatCollectionAbortMessage(info)).toContain('ECollectionSupplyExceeded')
  })

  it('enhanceCollectionError attaches the parsed abort info', () => {
    const original = new Error(
      "MoveAbort in 1st command, abort code: 4, in '0xab::collection::add_soul' (instruction 7)",
    )
    const enhanced = enhanceCollectionError(original) as Error & { collectionAbort?: { code: number } }
    expect(enhanced.name).toBe('SoulidityCollectionAbortError')
    expect(enhanced.collectionAbort?.code).toBe(4)
    expect(getCollectionAbortInfo(enhanced)?.entry.name).toBe('ECollectionSupplyExceeded')
  })

  it('enhanceSoulidityError handles collection aborts, not only market aborts', () => {
    const original = new Error(
      "MoveAbort in 1st command, abort code: 4, in '0xab::collection::add_soul' (instruction 7)",
    )
    const enhanced = enhanceSoulidityError(original) as Error & { collectionAbort?: { code: number } }
    expect(enhanced.name).toBe('SoulidityCollectionAbortError')
    expect(enhanced.collectionAbort?.code).toBe(4)
  })
})
