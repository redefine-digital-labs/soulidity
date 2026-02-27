import type { CollectedItem } from './types.js'

const SEARCH_QUERIES = [
  'ai agent',
  'llm blockchain',
  'web3 ai',
]

interface GitHubSearchResult {
  items: Array<{
    full_name: string
    html_url: string
    description: string | null
    stargazers_count: number
    language: string | null
    created_at: string
    topics: string[]
  }>
}

export async function collectGithub(): Promise<CollectedItem[]> {
  const items: CollectedItem[] = []
  const seenUrls = new Set<string>()

  const since = new Date()
  since.setDate(since.getDate() - 7)
  const sinceStr = since.toISOString().split('T')[0]

  for (const query of SEARCH_QUERIES) {
    try {
      const q = encodeURIComponent(`${query} created:>${sinceStr}`)
      const resp = await fetch(
        `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=10`,
        {
          headers: {
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'ClawNews/0.1',
          },
        }
      )

      if (!resp.ok) {
        console.error(`GitHub API error for "${query}": ${resp.status}`)
        continue
      }

      const data = await resp.json() as GitHubSearchResult

      for (const repo of data.items) {
        if (seenUrls.has(repo.html_url)) continue
        seenUrls.add(repo.html_url)

        items.push({
          source_type: 'github',
          source_name: 'github-trending',
          title: `${repo.full_name} ⭐${repo.stargazers_count}`,
          url: repo.html_url,
          content: repo.description ?? '',
          language: 'en',
          raw_data: repo,
        })
      }
    } catch (err) {
      console.error(`Failed to search GitHub for "${query}":`, err)
    }
  }

  return items
}
