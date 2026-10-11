const DEFAULT_APP_BASE_URL = 'https://clawnews-mu.vercel.app'

export function getAppBaseUrl(): string {
  const configuredBaseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim()
  if (configuredBaseUrl) {
    return configuredBaseUrl
  }

  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:3000'
  }

  return DEFAULT_APP_BASE_URL
}
