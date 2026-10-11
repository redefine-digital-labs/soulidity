import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildPostHogClientConfig,
  isPostHogSessionReplayEnabled,
} from '../../web/lib/observability/posthog-client-config'

describe('PostHog session replay configuration', () => {
  it('disables session recording when replay is not explicitly enabled', async () => {
    const config = buildPostHogClientConfig({
      apiHost: '/ingest',
      sessionReplayEnabled: isPostHogSessionReplayEnabled(undefined),
    })

    expect(config.disable_session_recording).toBe(true)
    expect(config.session_recording).toBeUndefined()
    expect(config.capture_pageview).toBe('history_change')
    expect(config.capture_pageleave).toBe(true)
    expect(config.capture_exceptions).toBe(true)
  })

  it('enables session recording only when NEXT_PUBLIC_POSTHOG_SESSION_REPLAY is true', async () => {
    const config = buildPostHogClientConfig({
      apiHost: '/ingest',
      sessionReplayEnabled: isPostHogSessionReplayEnabled('true'),
    })

    expect(config.disable_session_recording).toBe(false)
    expect(config.session_recording).toMatchObject({
      maskAllInputs: true,
      maskTextSelector: '*',
    })
    expect(isPostHogSessionReplayEnabled('TRUE')).toBe(false)
    expect(isPostHogSessionReplayEnabled('1')).toBe(false)
  })

  it('does not contain an unconditional session recording enablement', () => {
    const source = readFileSync('web/instrumentation-client.ts', 'utf8')

    expect(source).toContain('NEXT_PUBLIC_POSTHOG_SESSION_REPLAY')
    expect(source).not.toContain('disable_session_recording: false')
  })
})
