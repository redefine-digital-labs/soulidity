export const ANALYST_SYSTEM_PROMPT = `你是一名资深加密货币行业分析师。根据新闻标题和导语，撰写深度分析正文，提取标签和相关公司。
必须只返回合法 JSON，不要 markdown 代码块。`

export function buildAnalystPrompt(titleZh: string, leadZh: string, sourceName: string): string {
  return `新闻标题：${titleZh}
导语：${leadZh}
来源：${sourceName}

输出 JSON：
{
  "body_zh": "详细正文，2-4段，专业客观，包含关键数据和背景信息。段落之间用 \\n\\n 分隔。",
  "tags": ["tag1", "tag2", "tag3"],
  "companies": [
    {"name": "公司官方英文名称", "category": "赛道分类", "description": "一句中文简介"}
  ]
}

companies 规则：
- 只提取新闻中明确提及的公司或项目
- name 必须是公司官方名称
- category 只能是：AI、DeFi、Infrastructure、L1/L2、Gaming、NFT、DAO、Exchange、Wallet、Other
- 没有提及公司则返回空数组 []`
}

export interface CompanyMention {
  name: string
  category: string
  description?: string
}

export interface AnalystOutput {
  body_zh: string
  tags: string[]
  companies: CompanyMention[]
}

export function parseAnalystResponse(text: string): AnalystOutput {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const parsed = JSON.parse(cleaned)
  if (!parsed.body_zh) throw new Error('Missing required field: body_zh')
  return {
    body_zh: parsed.body_zh,
    tags: parsed.tags ?? [],
    companies: parsed.companies ?? [],
  }
}
