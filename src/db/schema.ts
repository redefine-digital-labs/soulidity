export const SCHEMA = `
CREATE TABLE IF NOT EXISTS raw_items (
  id          TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL UNIQUE,
  title_hash  TEXT,
  content     TEXT,
  language    TEXT DEFAULT 'en',
  score       REAL DEFAULT 0,
  status      TEXT DEFAULT 'new',
  raw_data    TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS articles (
  id          TEXT PRIMARY KEY,
  raw_item_id TEXT REFERENCES raw_items(id),
  title_zh    TEXT NOT NULL,
  title_en    TEXT NOT NULL,
  summary_zh  TEXT NOT NULL,
  summary_en  TEXT NOT NULL,
  analysis_zh TEXT,
  analysis_en TEXT,
  tags        TEXT,
  status      TEXT DEFAULT 'draft',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS publications (
  id           TEXT PRIMARY KEY,
  article_id   TEXT REFERENCES articles(id),
  channel      TEXT NOT NULL,
  message_id   TEXT,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS members (
  id          TEXT PRIMARY KEY,
  tg_id       TEXT NOT NULL UNIQUE,
  tg_name     TEXT,
  wallet      TEXT,
  level       INTEGER DEFAULT 1,
  invite_code TEXT,
  joined_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_raw_items_status ON raw_items(status);
CREATE INDEX IF NOT EXISTS idx_raw_items_score ON raw_items(score DESC);
CREATE INDEX IF NOT EXISTS idx_raw_items_created_at ON raw_items(created_at);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_members_tg_id ON members(tg_id);

CREATE TABLE IF NOT EXISTS invite_codes (
  code       TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now')),
  used_by    TEXT,
  active     INTEGER DEFAULT 1
);
`;
