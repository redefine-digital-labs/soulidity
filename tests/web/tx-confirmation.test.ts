import { describe, expect, it, vi } from 'vitest'

import { waitForTransactionBestEffort } from '../../web/lib/souls/tx-confirmation.ts'

describe('waitForTransactionBestEffort', () => {
  it('swallows confirmation polling failures after a digest is already known', async () => {
    const client = {
      waitForTransaction: vi.fn().mockRejectedValue(new Error('rpc timeout')),
    }
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(waitForTransactionBestEffort(client, '11111111111111111111111111111111')).resolves.toBeUndefined()
    expect(client.waitForTransaction).toHaveBeenCalledWith({
      digest: '11111111111111111111111111111111',
    })
    expect(consoleWarn).toHaveBeenCalledWith(
      '[sui] Transaction confirmation polling failed',
      expect.objectContaining({
        digest: '11111111111111111111111111111111',
        error: expect.any(Error),
      }),
    )

    consoleWarn.mockRestore()
  })
})
