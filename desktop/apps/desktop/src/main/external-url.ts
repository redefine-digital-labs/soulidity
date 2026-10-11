const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

export function validateOpenExternalUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid external URL')
  }

  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Blocked URL scheme: ${parsed.protocol}`)
  }

  return parsed.toString()
}
