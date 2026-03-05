export const REPORTER_SYSTEM_PROMPT = `你是一名专业的加密货币记者。根据原始素材撰写简洁的中文新闻标题和导语。
必须只返回合法 JSON，不要 markdown 代码块。`

export function buildReporterPrompt(title: string, content: string, sourceName: string): string {
  return `原始素材：
标题：${title}
来源：${sourceName}
内容：${content}

输出 JSON：
{
  "title_zh": "简洁有力的中文新闻标题",
  "lead_zh": "以'据 ${sourceName} 报道/消息'开头的一句话核心事实"
}`
}

export interface ReporterOutput {
  title_zh: string
  lead_zh: string
}

export function parseReporterResponse(text: string): ReporterOutput {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const parsed = JSON.parse(cleaned)
  if (!parsed.title_zh) throw new Error('Missing required field: title_zh')
  if (!parsed.lead_zh) throw new Error('Missing required field: lead_zh')
  return { title_zh: parsed.title_zh, lead_zh: parsed.lead_zh }
}
