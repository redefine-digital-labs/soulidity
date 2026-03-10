import crypto from 'crypto'

export interface TelegramLoginData {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

export function verifyTelegramLogin(data: TelegramLoginData): boolean {
  const { hash, ...rest } = data
  const secret = crypto.createHash('sha256').update(process.env.TG_BOT_TOKEN!).digest()
  const checkString = Object.keys(rest)
    .sort()
    .map(k => `${k}=${(rest as Record<string, unknown>)[k]}`)
    .join('\n')
  const hmac = crypto.createHmac('sha256', secret).update(checkString).digest('hex')
  if (hmac !== hash) return false
  // auth_date must be within 1 day
  if (Date.now() / 1000 - data.auth_date > 86400) return false
  return true
}
