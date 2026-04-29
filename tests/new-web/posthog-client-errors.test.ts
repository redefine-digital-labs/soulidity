import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureException = vi.fn()

interface ListenerTarget {
  __soulidityPostHogErrorHandlersInstalled__?: boolean
  addEventListener: (type: string, listener: (event: any) => void) => void
  removeEventListener: (type: string, listener: (event: any) => void) => void
}

function createListenerTarget() {
  const listeners = new Map<string, Array<(event: any) => void>>()
  const target: ListenerTarget = {
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((candidate) => candidate !== listener))
    },
  }
  return { target, listeners }
}

describe('PostHog frontend error capture', () => {
  beforeEach(() => {
    vi.resetModules()
    captureException.mockReset()
  })

  it('registers global browser error and unhandled rejection handlers', async () => {
    const { target, listeners } = createListenerTarget()
    const { installPostHogGlobalErrorHandlers } = await import('../../web/lib/observability/posthog-client-errors')

    const cleanup = installPostHogGlobalErrorHandlers(target, (error, properties) => {
      captureException(error, properties)
    })

    expect(listeners.get('error')).toHaveLength(1)
    expect(listeners.get('unhandledrejection')).toHaveLength(1)

    const syncError = new Error('wasm compile failed')
    listeners.get('error')![0]!({
      error: syncError,
      message: syncError.message,
      filename: '/_next/static/chunks/app-create.js',
      lineno: 12,
      colno: 34,
    })

    const asyncError = new Error('upload rejected')
    listeners.get('unhandledrejection')![0]!({ reason: asyncError })

    expect(captureException).toHaveBeenNthCalledWith(
      1,
      syncError,
      expect.objectContaining({
        source: 'window.error',
        filename: '/_next/static/chunks/app-create.js',
        lineno: 12,
        colno: 34,
      }),
    )
    expect(captureException).toHaveBeenNthCalledWith(
      2,
      asyncError,
      expect.objectContaining({ source: 'window.unhandledrejection' }),
    )

    cleanup()
    expect(listeners.get('error')).toHaveLength(0)
    expect(listeners.get('unhandledrejection')).toHaveLength(0)
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
})
