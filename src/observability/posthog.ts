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

const SERVICE_DISTINCT_ID = 'clawnews-backend'

export function captureBackendException(
  error: unknown,
  properties?: Record<string, unknown>,
): void {
  const client = resolveClient()
  if (!client) return
  const err = error instanceof Error ? error : new Error(String(error))
  client.captureException(err, SERVICE_DISTINCT_ID, scrubProperties(properties))
}

export function captureBackendEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  const client = resolveClient()
  if (!client) return
  client.capture({
    distinctId: SERVICE_DISTINCT_ID,
    event,
    properties: scrubProperties(properties),
  })
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
