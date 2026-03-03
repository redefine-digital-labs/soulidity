export type SourceType = 'rss' | 'github'
export type RawItemStatus = 'new' | 'deduped' | 'duplicate' | 'processing' | 'produced' | 'published' | 'rejected'
export type ArticleStatus = 'draft' | 'reviewed' | 'published'

export interface RawItem {
  id: string
  source_type: SourceType
  source_name: string
  title: string
  url: string
  title_hash: string | null
  content: string | null
  language: string
  score: number
  status: RawItemStatus
  raw_data: string | null
  created_at: string
}

export interface Article {
  id: string
  raw_item_id: string
  title_zh: string
  title_en: string
  summary_zh: string
  summary_en: string
  analysis_zh: string | null
  analysis_en: string | null
  tags: string | null
  status: ArticleStatus
  created_at: string
}

export interface Publication {
  id: string
  article_id: string
  channel: string
  message_id: string | null
  published_at: string | null
}

export interface Member {
  id: string
  tg_id: string
  tg_name: string | null
  wallet: string | null
  level: number
  invite_code: string | null
  joined_at: string
}
