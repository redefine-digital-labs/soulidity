import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createDb } from '../../src/db/database.js'
import { MEMBERS_SCHEMA, createInviteCode, validateInviteCode, useInviteCode, insertMember, getMembers } from '../../src/db/members.js'

let db: Database.Database

beforeEach(() => {
  db = createDb(':memory:')
  db.exec(MEMBERS_SCHEMA)
})

afterEach(() => {
  db.close()
})

describe('invite codes', () => {
  it('creates and validates invite code', () => {
    const code = createInviteCode(db)
    expect(code).toHaveLength(8)
    expect(validateInviteCode(db, code)).toBe(true)
  })

  it('invalidates after use', () => {
    const code = createInviteCode(db)
    expect(useInviteCode(db, code, 'user123')).toBe(true)
    expect(validateInviteCode(db, code)).toBe(false)
    expect(useInviteCode(db, code, 'user456')).toBe(false)
  })

  it('rejects invalid code', () => {
    expect(validateInviteCode(db, 'BADCODE')).toBe(false)
  })
})

describe('members', () => {
  it('inserts and retrieves members', () => {
    insertMember(db, 'tg_123', 'TestUser', 'CODE1')
    const members = getMembers(db)
    expect(members).toHaveLength(1)
    expect(members[0].tg_id).toBe('tg_123')
  })
})
