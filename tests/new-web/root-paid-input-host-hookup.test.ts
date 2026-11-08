import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { completePreflightFixture } from './fixtures/commerce-new-paid-preflight'
import { reviewNativePublicReadPaidInputsV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-input-provider-v2'
import { createNativePublicReadPaidHostPreflightV2, NativePublicReadPaidHostRecoveryErrorV2 } from '../../web/lib/soulidity/native-public-read-paid-host-v2'
import { browserNativePublicReadPaidJournalV2, nativePublicReadPaidKeyV2 } from '../../web/lib/soulidity/native-public-read-paid-journal-v2'
import { publicMutationCanonical } from '../../web/lib/sui/public-mutation-journal'

let dom: JSDOM
beforeEach(() => {
  dom = new JSDOM('', { url: 'https://input-host.test' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('navigator', dom.window.navigator)
  const held = new Set<string>()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (key: string, _options: unknown, work: (lock: unknown) => unknown) => {
      if (held.has(key)) return work(null)
      held.add(key); try { return await work({ name: key }) } finally { held.delete(key) }
    },
  } })
})
afterEach(() => { dom.window.close(); vi.unstubAllGlobals() })
async function fixture() {
  const x = await completePreflightFixture()
  x.client.ledgerService.getTransaction = vi.fn(async () => { throw { code: 'NOT_FOUND' } })
  x.client.ledgerService.getCheckpoint = vi.fn(async () => { throw Error('UNEXPECTED_CHECKPOINT') })
  return { ...x, journal: browserNativePublicReadPaidJournalV2(), key: nativePublicReadPaidKeyV2({ chainIdentifier: '35834a8a', soulId: x.params.soulId, author: x.buyer }) }
}
it('actual provider feeds the existing Host while durable original readback still precedes its sole full simulation', async () => {
  const x = await fixture(), calls: string[] = []
  const inputReviewer = vi.fn(async (request: Parameters<typeof reviewNativePublicReadPaidInputsV2>[0]) => {
    expect(await x.journal.read(x.key)).toBeNull(); calls.push('review')
    return reviewNativePublicReadPaidInputsV2(request)
  })
  const simulate = x.client.transactionExecutionService.simulateTransaction
  x.client.transactionExecutionService.simulateTransaction = vi.fn(async (request: any) => {
    expect((await x.journal.read(x.key))?.packet.phase).toBe('PREPARED'); calls.push('full-simulation')
    return simulate(request)
  })
  const result = await createNativePublicReadPaidHostPreflightV2({ inputReviewer })(x.input)
  expect(inputReviewer).toHaveBeenCalledOnce(); expect(calls).toEqual(['review', 'full-simulation'])
  expect((await x.journal.read(x.key))?.plan.originalText).toBe(result.retainedText)
  expect(x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledOnce()
})
it('a retained PREPARED original is recovered before any new provider, quote or ABI work', async () => {
  const x = await fixture(), original = await createNativePublicReadPaidHostPreflightV2()(x.input)
  const raw = window.localStorage.getItem(x.key), before = x.client.core.getMoveFunction.mock.calls.length
  const inputReviewer = vi.fn(async () => { throw Error('NEW_PROVIDER_MUST_NOT_RUN') })
  const error = await createNativePublicReadPaidHostPreflightV2({ inputReviewer })({ ...x.input, attempt: new Uint8Array(32).fill(2) }).catch(error => error)
  expect(error).toBeInstanceOf(NativePublicReadPaidHostRecoveryErrorV2)
  expect(error.message).toContain('ORIGINAL_RECOVERY_REQUIRED'); expect(error.recovery.text).toBe(original.retainedText)
  expect(inputReviewer).not.toHaveBeenCalled(); expect(x.client.core.getMoveFunction.mock.calls.length).toBe(before)
  expect(window.localStorage.getItem(x.key)).toBe(raw); expect(x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledOnce()
})
it.each(['gas', 'attempt', 'qualification'] as const)('a provider cannot replace selected %s before the Host prepares an original', async kind => {
  const x = await fixture(), before = publicMutationCanonical(x.input.attempt)
  const inputReviewer = async (request: Parameters<typeof reviewNativePublicReadPaidInputsV2>[0]) => {
    const result = await reviewNativePublicReadPaidInputsV2(request)
    if (result.status !== 'PURCHASE_INPUTS_REVIEWED') throw Error('FIXTURE_REVIEW_REQUIRED')
    if (kind === 'gas') result.preflightInput.gas.budget = String(BigInt(result.preflightInput.gas.budget) + 1n)
    if (kind === 'attempt') result.preflightInput.attempt[0] ^= 1
    if (kind === 'qualification') result.preflightInput.qualification.requiredScope += 1n
    return result
  }
  await expect(createNativePublicReadPaidHostPreflightV2({ inputReviewer })(x.input)).rejects.toThrow('INPUT_REVIEW_SELECTION_CHANGED')
  expect(await x.journal.read(x.key)).toBeNull(); expect(x.client.transactionExecutionService.simulateTransaction).not.toHaveBeenCalled()
  expect(publicMutationCanonical(x.input.attempt)).toBe(before)
  await createNativePublicReadPaidHostPreflightV2()(x.input)
  expect(x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledOnce()
})
it('captures the first reviewer getter and its original private receiver once', async () => {
  const x = await fixture(); let gets = 0
  class Services {
    #calls = 0
    get inputReviewer() { if (++gets > 1) throw Error('REPEATED_GETTER'); return this.review }
    async review(input: Parameters<typeof reviewNativePublicReadPaidInputsV2>[0]) { this.#calls++; return reviewNativePublicReadPaidInputsV2(input) }
    get calls() { return this.#calls }
  }
  const services = new Services(), host = createNativePublicReadPaidHostPreflightV2(services)
  await host(x.input); expect(gets).toBe(1); expect(services.calls).toBe(1)
  await expect(host(x.input)).rejects.toThrow('ORIGINAL_RECOVERY_REQUIRED'); expect(gets).toBe(1); expect(services.calls).toBe(1)
})
it('wallet replacement after provider completion cannot persist or simulate a new original', async () => {
  const x = await fixture(); let buyer: string | null = x.buyer
  const inputReviewer = async (request: Parameters<typeof reviewNativePublicReadPaidInputsV2>[0]) => {
    const result = await reviewNativePublicReadPaidInputsV2(request); buyer = null; return result
  }
  await expect(createNativePublicReadPaidHostPreflightV2({ inputReviewer })({ ...x.input, getBuyerAddress: () => buyer })).rejects.toThrow('WALLET_CHANGED')
  expect(await x.journal.read(x.key)).toBeNull(); expect(x.client.transactionExecutionService.simulateTransaction).not.toHaveBeenCalled()
})
