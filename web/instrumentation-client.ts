import posthog from 'posthog-js'

const token = process.env.NEXT_PUBLIC_POSTHOG_KEY
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || '/ingest'

if (token) {
  posthog.init(token, {
    api_host: host,
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
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '*',
      maskTextFn: (text, element) => {
        if (element?.closest('[data-ph-allow]')) return text
        return '*'.repeat(text.length)
      },
    },
    disable_session_recording: false,
    sanitize_properties: properties => {
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
      for (const [k, v] of Object.entries(properties)) {
        const lower = k.toLowerCase()
        if (blacklist.some(bad => lower.includes(bad))) continue
        out[k] = v
      }
      return out
    },
    loaded: ph => {
      if (process.env.NODE_ENV === 'development') {
        ph.debug(false)
      }
    },
  })
}
