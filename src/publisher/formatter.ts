interface FormatInput {
  title_zh: string
  summary_zh: string
  analysis_zh: string | null
  tags: string | null
  source_url: string
}

export function formatArticle(input: FormatInput): string {
  const tags = input.tags ? JSON.parse(input.tags).map((t: string) => `#${t}`).join(' ') : ''

  let msg = `📰 ${input.title_zh}`

  if (tags) msg += `\n🏷️ ${tags}`

  msg += `\n\n📝 摘要\n${input.summary_zh}`

  if (input.analysis_zh) {
    msg += `\n\n🔍 解读\n${input.analysis_zh}`
  }

  msg += `\n\n🔗 ${input.source_url}`
  msg += `\n\n---\nby ClawNews 🦞`

  return msg
}
