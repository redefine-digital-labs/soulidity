export const DEFAULT_WEB_BASE_URL = 'https://clawnews-mu.vercel.app'
export function getDesktopWebBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configuredBaseUrl = env['SOULIDITY_WEB_URL']?.trim() || env['NEXT_PUBLIC_BASE_URL']?.trim()
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, '')
  }

  return DEFAULT_WEB_BASE_URL
}

interface ReadDesktopJsonResponseOptions {
  action: string
  baseUrl: string
  pathname: string
}

function getBodyPreview(bodyText: string, maxLength = 120): string | null {
  const normalized = bodyText.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return null
  }

  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength)}...`
}

function looksLikeHtml(bodyText: string): boolean {
  return /^\s*<!doctype html/i.test(bodyText)
    || /^\s*<html[\s>]/i.test(bodyText)
    || /^\s*<head[\s>]/i.test(bodyText)
    || /^\s*<body[\s>]/i.test(bodyText)
}

function getJsonErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null
  }

  const error = (body as Record<string, unknown>).error
  return typeof error === 'string' && error.trim() ? error : null
}

function parseJsonBody(bodyText: string): unknown {
  const trimmed = bodyText.trim()
  if (!trimmed) {
    return null
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function buildUnexpectedResponseMessage(
  response: Response,
  options: ReadDesktopJsonResponseOptions,
  bodyText: string,
): string {
  const endpoint = `${options.baseUrl}${options.pathname}`
  const contentType = response.headers.get('content-type')?.trim() || 'unknown content-type'

  if (looksLikeHtml(bodyText)) {
    return `${options.action} failed: ${endpoint} returned HTML (${response.status}) instead of JSON. `
      + `The configured web app is missing this desktop API or points to the wrong deployment. `
      + `Use a deployed web app that serves ${options.pathname}.`
  }

  const preview = getBodyPreview(bodyText)
  if (preview) {
    return `${options.action} failed: ${endpoint} returned ${contentType} (${response.status}) instead of JSON. `
      + `Response preview: ${preview}`
  }

  return `${options.action} failed: ${endpoint} returned ${contentType} (${response.status}) instead of JSON.`
}

export async function readDesktopJsonResponse<T>(
  response: Response,
  options: ReadDesktopJsonResponseOptions,
): Promise<T> {
  const bodyText = await response.text()
  const body = parseJsonBody(bodyText)
  const jsonErrorMessage = getJsonErrorMessage(body)

  if (!response.ok) {
    throw new Error(jsonErrorMessage ?? buildUnexpectedResponseMessage(response, options, bodyText))
  }

  if (body !== null) {
    return body as T
  }

  throw new Error(buildUnexpectedResponseMessage(response, options, bodyText))
}
