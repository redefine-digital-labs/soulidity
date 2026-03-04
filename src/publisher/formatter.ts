interface FormatInput {
  title_zh: string
  summary_zh: string
  analysis_zh: string | null
  tags: string | null
  companies?: string[]
  source_url: string
}

/** Telegram hashtag: strip spaces & special chars, e.g. "L1/L2" → #L1L2 */
function toHashtag(s: string): string {
  return '#' + s.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '')
}

export function formatArticle(input: FormatInput): string {
  const tags = input.tags ? JSON.parse(input.tags).map((t: string) => toHashtag(t)).join(' ') : ''
  const companyTags = (input.companies ?? []).map(c => toHashtag(c)).join(' ')
  const allTags = [tags, companyTags].filter(Boolean).join(' ')

  let msg = `📰 ${input.title_zh}`

  if (allTags) msg += `\n🏷️ ${allTags}`

  msg += `\n\n📝 摘要\n${input.summary_zh}`

  if (input.analysis_zh) {
    msg += `\n\n🔍 解读\n${input.analysis_zh}`
  }

  msg += `\n\n🔗 ${input.source_url}`
  msg += `\n\n---\nby ClawNews 🦞`

  return msg
}
