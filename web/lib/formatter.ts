interface FormatInput {
  title_zh: string
  summary_zh: string
  analysis_zh: string | null
  source_url: string
}

export function formatArticle(input: FormatInput): string {
  const now = new Date()
  const month = now.getMonth() + 1
  const day = now.getDate()

  let msg = input.title_zh
  msg += `\n\nCryptoOpenClaw 消息，${month} 月 ${day} 日，${input.summary_zh}`

  if (input.analysis_zh) {
    msg += `\n\n${input.analysis_zh}`
  }

  msg += `\n\n原文链接 ${input.source_url}`

  return msg
}
