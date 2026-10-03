import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { init } = vi.hoisted(() => ({ init: vi.fn() }))
vi.mock('../../web/node_modules/posthog-js', () => ({ default: { init } }))

beforeEach(() => { vi.resetModules(); init.mockClear() })
afterEach(() => { vi.unstubAllEnvs() })

it('loads the existing analytics initializer from the real Vite entry', () => {
  const entry = readFileSync('web/spa/main.tsx', 'utf8')
  expect(entry).toMatch(/^import ['"]\.\.\/instrumentation-client['"]/m)
})

it('initializes the browser client once with the public host and replay disabled', async () => {
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test_public')
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://us.i.posthog.com')
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_SESSION_REPLAY', 'false')
  await import('../../web/instrumentation-client')
  await import('../../web/instrumentation-client')
  expect(init).toHaveBeenCalledTimes(1)
  expect(init).toHaveBeenCalledWith('phc_test_public', expect.objectContaining({
    api_host: 'https://us.i.posthog.com', disable_session_recording: true,
    capture_pageview: 'history_change',
  }))
})

it('does not initialize or require credentials when no public key is configured', async () => {
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '')
  await import('../../web/instrumentation-client')
  expect(init).not.toHaveBeenCalled()
})
