interface FormatInput {
  title_zh: string
  summary_zh: string
  analysis_zh: string | null
  source_url: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function formatArticle(input: FormatInput): string {
  const now = new Date()
  const month = now.getMonth() + 1
  const day = now.getDate()

  let msg = `<b>${escapeHtml(input.title_zh)}</b>`
  msg += `\n\nCryptoOpenClaw 消息，${month} 月 ${day} 日，${escapeHtml(input.summary_zh)}`

  if (input.analysis_zh) {
    msg += `\n\n${escapeHtml(input.analysis_zh)}`
  }

  msg += `\n\n原文链接 ${escapeHtml(input.source_url)}`

  return msg
}
