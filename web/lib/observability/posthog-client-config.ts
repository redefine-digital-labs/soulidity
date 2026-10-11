type PostHogClientConfig = {
  api_host: string
  ui_host: string
  capture_pageview: 'history_change'
  capture_pageleave: true
  capture_performance: { web_vitals: true }
  capture_exceptions: true
  autocapture: true
  mask_all_text: true
  mask_all_element_attributes: true
  mask_personal_data_properties: true
  persistence: 'localStorage+cookie'
  session_recording?: {
    maskAllInputs: true
    maskTextSelector: '*'
    maskTextFn: (text: string, element?: Element | null) => string
  }
  disable_session_recording: boolean
  sanitize_properties: (properties: Record<string, unknown>) => Record<string, unknown>
  loaded: (posthogClient: { debug: (enabled: boolean) => void }) => void
}

export function isPostHogSessionReplayEnabled(value = process.env.NEXT_PUBLIC_POSTHOG_SESSION_REPLAY) {
  return value === 'true'
}

function sanitizePostHogProperties(properties: Record<string, unknown>) {
  const blacklist = [
    'password',
    'secret',
    'token',
    'authorization',
    'mnemonic',
    'privatekey',
    'private_key',
    'sealsessionkey',
    'sealsession',
    'walrusblob',
    'walrus_blob',
    'email',
  ]
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(properties)) {
    const lower = key.toLowerCase()
    if (blacklist.some(bad => lower.includes(bad))) continue
    out[key] = value
  }
  return out
}

export function buildPostHogClientConfig({
  apiHost,
  sessionReplayEnabled,
}: {
  apiHost: string
  sessionReplayEnabled: boolean
}): PostHogClientConfig {
  return {
    api_host: apiHost,
    ui_host: 'https://us.posthog.com',
    capture_pageview: 'history_change',
    capture_pageleave: true,
    capture_performance: { web_vitals: true },
    capture_exceptions: true,
    autocapture: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    mask_personal_data_properties: true,
    persistence: 'localStorage+cookie',
    ...(sessionReplayEnabled
      ? {
          session_recording: {
            maskAllInputs: true,
            maskTextSelector: '*',
            maskTextFn: (text: string, element?: Element | null) => {
              if (element?.closest('[data-ph-allow]')) return text
              return '*'.repeat(text.length)
            },
          },
        }
      : {}),
    disable_session_recording: !sessionReplayEnabled,
    sanitize_properties: sanitizePostHogProperties,
    loaded: posthogClient => {
      if (process.env.NODE_ENV === 'development') {
        posthogClient.debug(false)
      }
    },
  }
}
