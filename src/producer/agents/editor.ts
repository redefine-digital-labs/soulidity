export const EDITOR_SYSTEM_PROMPT = `你是一名资深新闻编辑。审核并润色新闻稿件，确保准确性、可读性和专业性。
给出质量评分（1-10）和是否通过审核。
必须只返回合法 JSON，不要 markdown 代码块。`

export function buildEditorPrompt(titleZh: string, summaryZh: string, analysisZh: string): string {
  return `待审稿件：
标题：${titleZh}
导语：${summaryZh}
正文：${analysisZh}

请审核并润色，输出 JSON：
{
  "title_zh": "润色后的最终标题",
  "summary_zh": "润色后的最终导语",
  "analysis_zh": "润色后的最终正文",
  "quality_score": 8,
  "approved": true,
  "rejection_reason": null
}

规则：
- quality_score: 1-10，低于 5 分应 approved: false
- 如果内容质量太低或有明显错误，设 approved: false 并给出 rejection_reason
- 润色时保持原意，只修正语法、提升可读性`
}

export interface EditorOutput {
  title_zh: string
  summary_zh: string
  analysis_zh: string
  quality_score: number
  approved: boolean
  rejection_reason: string | null
}

export function parseEditorResponse(text: string): EditorOutput {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const parsed = JSON.parse(cleaned)
  if (!parsed.title_zh) throw new Error('Missing required field: title_zh')
  if (!parsed.summary_zh) throw new Error('Missing required field: summary_zh')
  return {
    title_zh: parsed.title_zh,
    summary_zh: parsed.summary_zh,
    analysis_zh: parsed.analysis_zh ?? '',
    quality_score: parsed.quality_score ?? 5,
    approved: parsed.approved ?? true,
    rejection_reason: parsed.rejection_reason ?? null,
  }
}
