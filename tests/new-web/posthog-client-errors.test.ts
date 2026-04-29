import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureException = vi.fn()

describe('PostHog frontend error capture', () => {
  beforeEach(() => {
    vi.resetModules()
    captureException.mockReset()
  })

  it('captures handled client errors with explicit scope metadata', async () => {
    const { captureFrontendException } = await import('../../web/lib/observability/posthog-client-errors')

    const error = new Error('handled upload failure')
    captureFrontendException(
      error,
      { scope: 'create_soul_deploy', phase: 'uploading-character' },
      captureException,
    )

    expect(captureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        scope: 'create_soul_deploy',
        phase: 'uploading-character',
        handled: true,
      }),
    )
  })

  it('does not duplicate exceptions already captured by PostHog auto capture', async () => {
    const { captureFrontendException } = await import('../../web/lib/observability/posthog-client-errors')
    const error = new Error('already captured') as Error & {
      __posthog_previously_captured_error?: boolean
    }
    error.__posthog_previously_captured_error = true

    captureFrontendException(error, { scope: 'window.error' }, captureException)

    expect(captureException).not.toHaveBeenCalled()
  })

  it('does not export a global window error handler installer alongside SDK autocapture', async () => {
    const mod = await import('../../web/lib/observability/posthog-client-errors')

    expect((mod as Record<string, unknown>).installPostHogGlobalErrorHandlers).toBeUndefined()
  })
})
