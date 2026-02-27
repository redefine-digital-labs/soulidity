import type Database from 'better-sqlite3'
import { v4 as uuid } from 'uuid'

export const MEMBERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS invite_codes (
  code       TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now')),
  used_by    TEXT,
  active     INTEGER DEFAULT 1
);
`

export function createInviteCode(db: Database.Database): string {
  const code = uuid().slice(0, 8).toUpperCase()
  db.prepare('INSERT INTO invite_codes (code) VALUES (?)').run(code)
  return code
}

export function validateInviteCode(db: Database.Database, code: string): boolean {
  const row = db.prepare('SELECT * FROM invite_codes WHERE code = ? AND active = 1 AND used_by IS NULL').get(code)
  return !!row
}

export function useInviteCode(db: Database.Database, code: string, tgId: string): boolean {
  const result = db.prepare('UPDATE invite_codes SET used_by = ?, active = 0 WHERE code = ? AND active = 1 AND used_by IS NULL').run(tgId, code)
  return result.changes > 0
}

export function insertMember(db: Database.Database, tgId: string, tgName: string | null, inviteCode: string): string {
  const id = uuid()
  db.prepare('INSERT OR IGNORE INTO members (id, tg_id, tg_name, invite_code) VALUES (?, ?, ?, ?)').run(id, tgId, tgName, inviteCode)
  return id
}

export function getMembers(db: Database.Database): Array<{ id: string; tg_id: string; tg_name: string | null; level: number; joined_at: string }> {
  return db.prepare('SELECT id, tg_id, tg_name, level, joined_at FROM members ORDER BY joined_at DESC').all() as Array<{ id: string; tg_id: string; tg_name: string | null; level: number; joined_at: string }>
}
