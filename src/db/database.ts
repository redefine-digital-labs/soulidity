import Database from 'better-sqlite3'
import { SCHEMA } from './schema.js'
import type { RawItem, Article, Publication, RawItemStatus, ArticleStatus } from '../shared/types.js'
import { v4 as uuid } from 'uuid'

export function createDb(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}

// --- raw_items ---

export function insertRawItem(
  db: Database.Database,
  item: Omit<RawItem, 'id' | 'created_at' | 'status'>
): string | null {
  const id = uuid()
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO raw_items (id, source_type, source_name, title, url, content, language, score, raw_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const result = stmt.run(id, item.source_type, item.source_name, item.title, item.url, item.content, item.language, item.score, item.raw_data)
  return result.changes > 0 ? id : null
}

export function getRawItemsByStatus(db: Database.Database, status: RawItemStatus, limit = 10): RawItem[] {
  return db.prepare('SELECT * FROM raw_items WHERE status = ? ORDER BY score DESC LIMIT ?').all(status, limit) as RawItem[]
}

export function updateRawItemStatus(db: Database.Database, id: string, status: RawItemStatus): void {
  db.prepare('UPDATE raw_items SET status = ? WHERE id = ?').run(status, id)
}

// --- articles ---

export function insertArticle(
  db: Database.Database,
  article: Omit<Article, 'id' | 'created_at' | 'status'>
): string {
  const id = uuid()
  db.prepare(`
    INSERT INTO articles (id, raw_item_id, title_zh, title_en, summary_zh, summary_en, analysis_zh, analysis_en, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, article.raw_item_id, article.title_zh, article.title_en, article.summary_zh, article.summary_en, article.analysis_zh, article.analysis_en, article.tags)
  return id
}

export function getArticlesByStatus(db: Database.Database, status: ArticleStatus, limit = 20): Article[] {
  return db.prepare('SELECT * FROM articles WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit) as Article[]
}

export function getArticleById(db: Database.Database, id: string): Article | undefined {
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as Article | undefined
}

export function updateArticle(db: Database.Database, id: string, fields: Partial<Pick<Article, 'title_zh' | 'title_en' | 'summary_zh' | 'summary_en' | 'analysis_zh' | 'analysis_en' | 'tags' | 'status'>>): void {
  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = ?`)
    values.push(value)
  }
  if (sets.length === 0) return
  values.push(id)
  db.prepare(`UPDATE articles SET ${sets.join(', ')} WHERE id = ?`).run(...values)
}

// --- publications ---

export function insertPublication(db: Database.Database, articleId: string, channel: string, messageId: string): string {
  const id = uuid()
  db.prepare(`
    INSERT INTO publications (id, article_id, channel, message_id, published_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(id, articleId, channel, messageId)
  return id
}

// --- stats ---

export function getStats(db: Database.Database): { raw_new: number; articles_draft: number; articles_reviewed: number; published_today: number } {
  const raw_new = (db.prepare('SELECT COUNT(*) as c FROM raw_items WHERE status = ?').get('new') as { c: number }).c
  const articles_draft = (db.prepare('SELECT COUNT(*) as c FROM articles WHERE status = ?').get('draft') as { c: number }).c
  const articles_reviewed = (db.prepare('SELECT COUNT(*) as c FROM articles WHERE status = ?').get('reviewed') as { c: number }).c
  const published_today = (db.prepare("SELECT COUNT(*) as c FROM publications WHERE published_at >= date('now')").get() as { c: number }).c
  return { raw_new, articles_draft, articles_reviewed, published_today }
}
