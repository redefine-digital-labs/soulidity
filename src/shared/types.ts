export type SourceType = 'rss' | 'github' | 'x'
export type RawItemStatus = 'new' | 'deduped' | 'duplicate' | 'processing' | 'produced' | 'published' | 'rejected' | 'expired' | 'pending_review'
export type ArticleStatus = 'draft' | 'published' | 'rejected'

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
  pipeline_status: PipelineStatus
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
  avatar: string | null
  bio: string | null
  exp: number
  joined_at: string
}

export type AgentRoleName = 'scout' | 'reporter' | 'analyst' | 'editor' | 'publisher'
export type PipelineStatus = 'pending' | 'scouting' | 'reporting' | 'analyzing' | 'editing' | 'publishing' | 'completed' | 'failed'
export type ProcessLogStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface AgentProcessLog {
  id: string
  article_id: string
  role_id: string
  role_name?: string
  status: ProcessLogStatus
  input: string | null
  output: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface Category {
  id: string
  name: string
  name_zh: string
  icon: string
  sort_order: number
  created_at: string
}

export interface Direction {
  id: string
  category_id: string
  name: string
  name_zh: string
  slug: string
  description: string | null
  description_zh: string | null
  icon: string
  user_count: number
  rating: number
  featured: boolean
  status: string
  created_at: string
  updated_at: string
}

export interface Post {
  id: string
  member_id: string
  direction_id: string | null
  title: string
  content: string
  tags: string | null
  like_count: number
  comment_count: number
  status: string
  created_at: string
  updated_at: string
}

export interface Comment {
  id: string
  post_id: string
  member_id: string
  content: string
  created_at: string
}

export interface Achievement {
  id: string
  name: string
  name_zh: string
  description: string | null
  icon: string
  condition: string | null
}
