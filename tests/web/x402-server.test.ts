import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted values — available before any vi.mock() factory runs
// ---------------------------------------------------------------------------

/** Holds the onAfterSettle callback captured from the most recent module load. */
const capturedSettleCallback = vi.hoisted(() => ({ fn: null as any }))

/**
 * The mock x402ResourceServer constructor.
 * Each `new x402ResourceServer(...)` call returns a fresh object whose
 * `onAfterSettle` spy stores the callback in capturedSettleCallback.
 */
const MockX402Server = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    onAfterSettle: vi.fn((cb: any) => {
      capturedSettleCallback.fn = cb
    }),
  })),
)

const MockHTTPFacilitatorClient = vi.hoisted(() => vi.fn())
const mockedRegisterExactSvmScheme = vi.hoisted(() => vi.fn())
const mockedExtractPaymentIdentifier = vi.hoisted(() => vi.fn())

/** Prisma tx-callback helpers — reused across tests. */
const transactionMocks = vi.hoisted(() => ({
  purchaseIntent: { update: vi.fn() },
  order: { create: vi.fn() },
  entitlement: { create: vi.fn() },
}))

const mockedPrisma = vi.hoisted(() => ({
  order: { findUnique: vi.fn() },
  purchaseIntent: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Static module mocks
// These are registered once and remain active for the whole file. They still
// work after vi.resetModules() because vi.doMock() is called in beforeEach
// to re-register them on each module reload.
// ---------------------------------------------------------------------------

vi.mock('@x402/core/server', () => ({
  HTTPFacilitatorClient: MockHTTPFacilitatorClient,
  x402ResourceServer: MockX402Server,
}))

vi.mock('@x402/extensions/payment-identifier', () => ({
  extractPaymentIdentifier: mockedExtractPaymentIdentifier,
}))

vi.mock('@x402/svm/exact/server', () => ({
  registerExactSvmScheme: mockedRegisterExactSvmScheme,
}))

vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal settle context the hook receives. */
function makeContext(txDigest = 'tx-abc') {
  return {
    paymentPayload: { some: 'payload' },
    result: { transaction: txDigest },
  }
}

const BASE_PURCHASE_INTENT = {
  id: 'intent-1',
  listingId: 'listing-1',
  memberId: 'buyer-1',
  agentMemberId: null,
  walletBindingId: 'wallet-1',
  expectedPriceMist: 1_000_000_000n,
  chain: 'solana',
  currency: 'USDC',
  listing: { bundleId: 'bundle-1' },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('x402-server onAfterSettle hook', () => {
  beforeEach(async () => {
    // 1. Reset call history on all hoisted mocks.
    vi.resetAllMocks()

    // 2. Purge the module registry so x402-server.ts re-evaluates fresh.
    vi.resetModules()

    // 3. Re-register mocks for every module that x402-server.ts imports,
    //    using vi.doMock() which is the dynamic equivalent of vi.mock() and
    //    must be called *after* vi.resetModules().
    vi.doMock('@x402/core/server', () => ({
      HTTPFacilitatorClient: MockHTTPFacilitatorClient,
      x402ResourceServer: MockX402Server,
    }))
    vi.doMock('@x402/extensions/payment-identifier', () => ({
      extractPaymentIdentifier: mockedExtractPaymentIdentifier,
    }))
    vi.doMock('@x402/svm/exact/server', () => ({
      registerExactSvmScheme: mockedRegisterExactSvmScheme,
    }))
    vi.doMock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))
    vi.doMock('@shared/prisma-errors', () => ({
      isUniqueConstraintError: (err: unknown) =>
        Boolean(err && typeof err === 'object' && 'code' in err && (err as any).code === 'P2002'),
    }))

    // 4. Restore the MockX402Server implementation (resetAllMocks clears it).
    MockX402Server.mockImplementation(() => ({
      onAfterSettle: vi.fn((cb: any) => {
        capturedSettleCallback.fn = cb
      }),
    }))

    // 5. Clear the global singleton guards so the module registers the hook.
    ;(globalThis as any).x402HookRegistered = false
    ;(globalThis as any).x402Server = undefined

    // 6. Default prisma $transaction wires the callback to transactionMocks.
    mockedPrisma.$transaction.mockImplementation(async (cb: any) => cb(transactionMocks))

    transactionMocks.order.create.mockResolvedValue({ id: 'order-1' })
    transactionMocks.purchaseIntent.update.mockResolvedValue({})
    transactionMocks.entitlement.create.mockResolvedValue({})

    // 7. Dynamically import the module — this triggers hook registration and
    //    populates capturedSettleCallback.fn via MockX402Server.onAfterSettle.
    await import('../../web/lib/x402-server.ts')
  })

  // -------------------------------------------------------------------------

  it('creates Order and Entitlement when a valid purchaseIntent exists', async () => {
    mockedExtractPaymentIdentifier.mockReturnValue('pay-req-1')
    mockedPrisma.order.findUnique.mockResolvedValue(null)
    mockedPrisma.purchaseIntent.findUnique.mockResolvedValue({ ...BASE_PURCHASE_INTENT })

    await capturedSettleCallback.fn(makeContext('tx-abc'))

    expect(transactionMocks.purchaseIntent.update).toHaveBeenCalledWith({
      where: { id: 'intent-1' },
      data: { status: 'confirmed', txDigest: 'tx-abc' },
    })

    expect(transactionMocks.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        listingId: 'listing-1',
        buyerId: 'buyer-1',
        agentMemberId: null,
        walletBindingId: 'wallet-1',
        purchaseIntentId: 'intent-1',
        priceMist: 1_000_000_000n,
        chain: 'solana',
        currency: 'USDC',
        paymentRequestId: 'pay-req-1',
        txDigest: 'tx-abc',
      }),
    })

    expect(transactionMocks.entitlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bundleId: 'bundle-1',
        orderId: 'order-1',
        memberId: 'buyer-1',
        walletBindingId: 'wallet-1',
      }),
    })
  })

  it('returns early without DB writes when an order with that paymentRequestId already exists', async () => {
    mockedExtractPaymentIdentifier.mockReturnValue('pay-req-dupe')
    mockedPrisma.order.findUnique.mockResolvedValue({ id: 'existing-order' })

    await capturedSettleCallback.fn(makeContext())

    expect(mockedPrisma.purchaseIntent.findUnique).not.toHaveBeenCalled()
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns early without DB writes when paymentRequestId is missing from the payload', async () => {
    mockedExtractPaymentIdentifier.mockReturnValue(null)

    await capturedSettleCallback.fn(makeContext())

    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled()
    expect(mockedPrisma.purchaseIntent.findUnique).not.toHaveBeenCalled()
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns early without DB writes when no purchaseIntent matches the paymentRequestId', async () => {
    mockedExtractPaymentIdentifier.mockReturnValue('pay-req-unknown')
    mockedPrisma.order.findUnique.mockResolvedValue(null)
    mockedPrisma.purchaseIntent.findUnique.mockResolvedValue(null)

    await capturedSettleCallback.fn(makeContext())

    expect(mockedPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('silently swallows a unique constraint error thrown inside $transaction', async () => {
    const uniqueError = Object.assign(new Error('Unique constraint violation'), { code: 'P2002' })

    mockedExtractPaymentIdentifier.mockReturnValue('pay-req-race')
    mockedPrisma.order.findUnique.mockResolvedValue(null)
    mockedPrisma.purchaseIntent.findUnique.mockResolvedValue({ ...BASE_PURCHASE_INTENT })
    mockedPrisma.$transaction.mockRejectedValue(uniqueError)

    // The hook must not throw — P2002 is handled and the callback resolves.
    await expect(capturedSettleCallback.fn(makeContext())).resolves.toBeUndefined()
  })

  it('re-throws non-unique-constraint errors from $transaction', async () => {
    const unexpectedError = new Error('DB connection lost')

    mockedExtractPaymentIdentifier.mockReturnValue('pay-req-err')
    mockedPrisma.order.findUnique.mockResolvedValue(null)
    mockedPrisma.purchaseIntent.findUnique.mockResolvedValue({ ...BASE_PURCHASE_INTENT })
    mockedPrisma.$transaction.mockRejectedValue(unexpectedError)

    await expect(capturedSettleCallback.fn(makeContext())).rejects.toThrow('DB connection lost')
  })
})
