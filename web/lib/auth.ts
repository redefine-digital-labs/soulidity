const COOKIE_NAME = 'clawnews-auth'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

export { COOKIE_NAME, COOKIE_MAX_AGE }

export async function hmacSign(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
