export const DEFAULT_APP_BASE_URL = 'https://clawnews-mu.vercel.app'

export function getAppBaseUrl(): string {
  const configuredBaseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim()
  if (configuredBaseUrl) {
    return configuredBaseUrl
  }

  const vercelUrl = process.env.VERCEL_URL?.trim()
  if (vercelUrl) {
    return `https://${vercelUrl}`
  }

  if (process.env.NODE_ENV !== 'production') {
    return 'http://localhost:3000'
  }

  return DEFAULT_APP_BASE_URL
}
