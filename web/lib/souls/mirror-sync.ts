type JsonResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text?: () => Promise<string>
}

type FetchLike = (input: string, init?: RequestInit) => Promise<JsonResponse>

const DEFAULT_MAX_ATTEMPTS = 2
const RETRY_BACKOFF_MS = 500

function waitForRetryDelay() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, RETRY_BACKOFF_MS)
  })
}

export class MirrorSyncError extends Error {
  readonly status: number | null
  readonly retryable: boolean
  readonly chainSucceeded: boolean

  constructor(
    message: string,
    options: {
      status?: number | null
      retryable: boolean
      chainSucceeded?: boolean
      cause?: unknown
    },
  ) {
    super(message)
    this.name = 'MirrorSyncError'
    this.status = options.status ?? null
    this.retryable = options.retryable
    this.chainSucceeded = options.chainSucceeded ?? true
    if (options.cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = options.cause
    }
  }
}

async function readResponseError(response: JsonResponse): Promise<string> {
  if (typeof response.text === 'function') {
    try {
      const text = (await response.text()).trim()
      if (text.length > 0) {
        try {
          const payload = JSON.parse(text)
          if (payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string') {
            return (payload as { error: string }).error
          }
        } catch {
          // Fall through to the raw text body below.
        }

        return text
      }
    } catch {
      // Ignore response parsing failures.
    }
  }

  try {
    const payload = await response.json()
    if (payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string') {
      return (payload as { error: string }).error
    }
  } catch {
    // Ignore response parsing failures.
  }

  return `Local sync failed with status ${response.status}`
}

export async function mirrorRouteRequest<T = unknown>(params: {
  fetchImpl?: FetchLike
  input: string
  init?: RequestInit
  maxAttempts?: number
}): Promise<T> {
  const fetchImpl = params.fetchImpl ?? (fetch as FetchLike)
  const maxAttempts = Math.max(1, params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  let lastError: MirrorSyncError | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(params.input, params.init)
      if (response.ok) {
        return await response.json() as T
      }

      const retryable = response.status >= 500
      const error = new MirrorSyncError(await readResponseError(response), {
        status: response.status,
        retryable,
      })
      if (!retryable || attempt === maxAttempts) {
        throw error
      }
      lastError = error
      await waitForRetryDelay()
    } catch (error) {
      if (error instanceof MirrorSyncError) {
        if (!error.retryable || attempt === maxAttempts) {
          throw error
        }
        lastError = error
        await waitForRetryDelay()
        continue
      }

      const wrapped = new MirrorSyncError('Network error while syncing the confirmed transaction', {
        retryable: true,
        cause: error,
      })
      if (attempt === maxAttempts) {
        throw wrapped
      }
      lastError = wrapped
      await waitForRetryDelay()
    }
  }

  throw lastError ?? new MirrorSyncError('Local sync failed after the on-chain transaction succeeded', {
    retryable: true,
  })
}

export function formatMirrorSyncError(error: unknown, txDigest?: string | null): string {
  const txSuffix = txDigest ? ` Tx: ${txDigest}.` : ''

  if (error instanceof MirrorSyncError) {
    if (error.status && error.status < 500) {
      return `Transaction confirmed on chain, but local sync was rejected: ${error.message}. Refresh to confirm state.${txSuffix}`
    }

    return `Transaction confirmed on chain, but local sync failed. Refresh to confirm state and contact support if it still does not appear.${txSuffix}`
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return `Transaction confirmed on chain, but local sync failed.${txSuffix}`
}
