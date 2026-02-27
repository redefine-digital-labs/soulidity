export interface CollectedItem {
  source_type: 'rss' | 'github'
  source_name: string
  title: string
  url: string
  content: string
  language: string
  raw_data: object
}

export type Collector = () => Promise<CollectedItem[]>
