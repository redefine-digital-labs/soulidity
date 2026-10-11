import * as cheerio from 'cheerio'
import { isIP } from 'node:net'
import dns from 'node:dns/promises'

// --- SSRF protection ---

const BLOCKED_RANGES = [
  /^127\./,               // loopback
  /^10\./,                // RFC 1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC 1918
  /^192\.168\./,          // RFC 1918
  /^169\.254\./,          // link-local
  /^0\./,                 // current network
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./, // CGNAT
  /^::1$/,                // IPv6 loopback
  /^f[cd]/i,              // IPv6 private
  /^fe80:/i,              // IPv6 link-local
]

function isPrivateIp(ip: string): boolean {
  return BLOCKED_RANGES.some(r => r.test(ip))
}

async function validateUrl(raw: string): Promise<URL> {
  const parsed = new URL(raw) // throws on invalid
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed')
  }

  const hostname = parsed.hostname
  // If hostname is already an IP, check directly
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('URL resolves to a private/reserved IP')
    return parsed
  }

  // Resolve DNS and check all addresses
  const { resolve4, resolve6 } = dns
  const addrs = await Promise.all([
    resolve4(hostname).catch(() => [] as string[]),
    resolve6(hostname).catch(() => [] as string[]),
  ]).then(([v4, v6]) => [...v4, ...v6])

  if (addrs.length === 0) throw new Error('Could not resolve hostname')
  if (addrs.some(isPrivateIp)) throw new Error('URL resolves to a private/reserved IP')

  return parsed
}

// --- Scraper ---

export async function scrapeUrl(url: string): Promise<{ title: string; content: string }> {
  const validated = await validateUrl(url)

  // Pin DNS resolution to prevent DNS rebinding SSRF (TOCTOU mitigation)
  const hostname = validated.hostname
  let connectUrl = url
  const extraHeaders: Record<string, string> = {}
  if (!isIP(hostname)) {
    const addrs = await dns.resolve4(hostname).catch(() => [] as string[])
    if (addrs.length > 0) {
      const pinnedIp = addrs[0]
      validated.hostname = pinnedIp
      connectUrl = validated.toString()
      extraHeaders['Host'] = hostname
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const res = await fetch(connectUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CryptoOpenClaw/1.0)',
        'Accept': 'text/html',
        ...extraHeaders,
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    return extractContent(html)
  } finally {
    clearTimeout(timeout)
  }
}

function extractContent(html: string): { title: string; content: string } {
  const $ = cheerio.load(html)

  // Remove unwanted elements
  $('script, style, nav, footer, header, aside, iframe, noscript, svg').remove()
  $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove()

  // Extract title
  const title = $('meta[property="og:title"]').attr('content')
    || $('title').text().trim()
    || $('h1').first().text().trim()

  // Extract content with priority: article > main > body
  let content = ''
  for (const selector of ['article', 'main', '[role="main"]', '.post-content', '.article-content', '.entry-content', 'body']) {
    const el = $(selector).first()
    if (el.length) {
      content = el.text().replace(/\s+/g, ' ').trim()
      if (content.length > 100) break
    }
  }

  if (!title && !content) throw new Error('Failed to extract content from page')

  // Truncate content to ~8000 chars to stay within LLM context
  if (content.length > 8000) content = content.slice(0, 8000) + '...'

  return { title: title || 'Untitled', content }
}
