'use client'

import { useFeatureFlagEnabled, useFeatureFlagPayload } from 'posthog-js/react'
import posthog from 'posthog-js'

/**
 * Read a boolean feature flag on the client. Returns `undefined` while the flag
 * is still loading; treat `undefined` as "use default behaviour" so SSR and
 * first-paint don't flicker.
 *
 * Typical kill-switch usage:
 *   const mainnetEnabled = useFeatureFlag('enable_mainnet_publish')
 *   if (mainnetEnabled === false) return <Banner>Mainnet temporarily paused</Banner>
 */
export function useFeatureFlag(key: string): boolean | undefined {
  return useFeatureFlagEnabled(key)
}

/**
 * Read a multivariate flag's payload (e.g. JSON config tied to a variant).
 * Returns `undefined` until loaded.
 */
export function useFeatureFlagJson<T = unknown>(key: string): T | undefined {
  return useFeatureFlagPayload(key) as T | undefined
}

/**
 * Imperative read for use outside React (event handlers, init code).
 * Returns the raw boolean/string variant or `undefined` if not yet loaded.
 */
export function readFeatureFlag(key: string): boolean | string | undefined {
  if (typeof window === 'undefined') return undefined
  return posthog.getFeatureFlag(key)
}
