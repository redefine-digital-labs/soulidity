import { afterEach, expect, it, vi } from 'vitest'
import { createNativeReceiveClient } from '../../web/lib/animacraft/native-receive'

afterEach(() => vi.unstubAllGlobals())
it('the actual gRPC transport passes request cancellation through to fetch', async () => {
  const controller = new AbortController()
  let observed: AbortSignal | null | undefined
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    observed = init?.signal
    controller.abort()
    throw new DOMException('Aborted', 'AbortError')
  })
  vi.stubGlobal('fetch', fetcher)
  const client = createNativeReceiveClient(controller.signal)
  await expect(client.ledgerService.getObject({ objectId: `0x${'1'.repeat(64)}` })).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledOnce()
  expect(observed?.aborted).toBe(true)
})
