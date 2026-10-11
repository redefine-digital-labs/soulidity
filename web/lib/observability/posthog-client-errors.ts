'use client'

import posthog from 'posthog-js'

type FrontendExceptionProperties = Record<string, unknown>
type CaptureException = (error: Error, properties: FrontendExceptionProperties) => unknown
type MaybePostHogCapturedError = Error & {
  __posthog_previously_captured_error?: boolean
}

function coerceError(error: unknown): Error {
  if (error instanceof Error) return error
  if (typeof error === 'string') return new Error(error)
  try {
    return new Error(JSON.stringify(error))
  } catch {
    return new Error(String(error))
  }
}

export function captureFrontendException(
  error: unknown,
  properties: FrontendExceptionProperties = {},
  captureException: CaptureException = posthog.captureException.bind(posthog),
) {
  try {
    const nextError = coerceError(error)
    if ((nextError as MaybePostHogCapturedError).__posthog_previously_captured_error) {
      return
    }
    captureException(nextError, {
      handled: true,
      ...properties,
    })
  } catch {
    // Telemetry must never create a secondary user-facing failure.
  }
}
