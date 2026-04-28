import { PostHog } from 'posthog-node'

const PII_BLACKLIST_KEYS = [
  'password',
  'passwd',
  'secret',
  'apikey',
  'api_key',
  'token',
  'authorization',
  'cookie',
  'mnemonic',
  'privatekey',
  'private_key',
  'sealsessionkey',
  'sealsession',
  'walrusblob',
  'walrus_blob',
  'email',
]

let cached: PostHog | null = null
let initialized = false
const POSTHOG_SHUTDOWN_TIMEOUT_MS = 5_000

function resolveClient(): PostHog | null {
  if (initialized) return cached
  initialized = true
  const key =
    process.env.POSTHOG_SERVER_KEY?.trim() ||
    process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim() ||
    process.env.POSTHOG_API_KEY?.trim()
  if (!key) return null
  const host = process.env.POSTHOG_INGEST_HOST?.trim() || 'https://us.i.posthog.com'
  cached = new PostHog(key, {
    host,
    flushAt: 1,
    flushInterval: 0,
    enableExceptionAutocapture: true,
  })
  return cached
}

function scrubProperties(input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    const lower = k.toLowerCase()
    if (PII_BLACKLIST_KEYS.some(bad => lower.includes(bad))) continue
    out[k] = v
  }
  return out
}

export function captureServerException(
  error: unknown,
  options?: {
    distinctId?: string
    properties?: Record<string, unknown>
  },
): void {
  const client = resolveClient()
  if (!client) return
  const err = error instanceof Error ? error : new Error(String(error))
  client.captureException(err, options?.distinctId, scrubProperties(options?.properties))
}

export function captureServerEvent(
  event: string,
  options: {
    distinctId: string
    properties?: Record<string, unknown>
  },
): void {
  const client = resolveClient()
  if (!client) return
  client.capture({
    distinctId: options.distinctId,
    event,
    properties: scrubProperties(options.properties),
  })
}

/**
 * Server-side feature flag eval. Returns `true`/`false` once resolved, or
 * `defaultValue` if the client is disabled / no token is configured.
 *
 * Use to gate risky paths in API routes:
 *   if (!(await isFeatureEnabledServer('enable_mainnet_publish', distinctId, true))) {
 *     return Response.json({ error: 'Mainnet publish temporarily disabled' }, { status: 503 })
 *   }
 */
export async function isFeatureEnabledServer(
  key: string,
  distinctId: string,
  defaultValue = false,
): Promise<boolean> {
  const client = resolveClient()
  if (!client) return defaultValue
  const result = await client.isFeatureEnabled(key, distinctId)
  return typeof result === 'boolean' ? result : defaultValue
}

export async function shutdownPostHog(): Promise<void> {
  const client = cached
  if (!client) return
  cached = null
  initialized = false
  await client.shutdown()
}

export async function shutdownPostHogWithTimeout(
  timeoutMs = POSTHOG_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  if (!cached) return
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      shutdownPostHog(),
      new Promise<void>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`posthog shutdown timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
