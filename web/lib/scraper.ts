import * as cheerio from 'cheerio'

export async function scrapeUrl(url: string): Promise<{ title: string; content: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ClawNews/1.0)',
        'Accept': 'text/html',
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
