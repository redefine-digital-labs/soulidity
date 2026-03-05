import { vi } from 'vitest'

interface MockStore {
  rawItems: any[]
  articles: any[]
  publications: any[]
  members: any[]
  inviteCodes: any[]
  companies: any[]
  articleCompanies: any[]
  agentRoles: any[]
  agentProcessLogs: any[]
}

function matchWhere(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (v === null || v === undefined) {
      return row[k] === null || row[k] === undefined
    }
    if (v && typeof v === 'object' && 'gte' in v) {
      return row[k] >= v.gte
    }
    return row[k] === v
  })
}

function applySelect(row: any, select: any): any {
  if (!select) return row
  const result: any = {}
  for (const key of Object.keys(select)) {
    if (select[key]) result[key] = row[key]
  }
  return result
}

function createModel(collection: any[], defaults: Record<string, any> = {}) {
  return {
    create: vi.fn(async ({ data }: any) => {
      const row = { id: crypto.randomUUID(), createdAt: new Date(), ...defaults, ...data }
      collection.push(row)
      return row
    }),
    findMany: vi.fn(async ({ where, orderBy, take, select }: any = {}) => {
      let rows = [...collection]
      if (where) {
        rows = rows.filter(r => matchWhere(r, where))
      }
      if (orderBy) {
        const [key, dir] = Object.entries(orderBy)[0] as [string, string]
        rows.sort((a, b) => dir === 'desc' ? (b[key] > a[key] ? 1 : -1) : (a[key] > b[key] ? 1 : -1))
      }
      if (take) rows = rows.slice(0, take)
      if (select) rows = rows.map(r => applySelect(r, select))
      return rows
    }),
    findUnique: vi.fn(async ({ where }: any) => {
      return collection.find(r => matchWhere(r, where)) ?? null
    }),
    findFirst: vi.fn(async ({ where, select }: any = {}) => {
      const row = collection.find(r => matchWhere(r, where))
      if (!row) return null
      return select ? applySelect(row, select) : row
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = collection.find(r => matchWhere(r, where))
      if (!row) {
        const err: any = new Error('Record not found')
        err.code = 'P2025'
        throw err
      }
      Object.assign(row, data)
      return row
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const existing = collection.find(r => matchWhere(r, where))
      if (existing) {
        for (const [k, v] of Object.entries(update)) {
          if (v && typeof v === 'object' && 'increment' in (v as any)) {
            existing[k] = (existing[k] ?? 0) + (v as any).increment
          } else {
            existing[k] = v
          }
        }
        return existing
      }
      const row = { id: crypto.randomUUID(), createdAt: new Date(), ...defaults, ...create }
      collection.push(row)
      return row
    }),
    count: vi.fn(async ({ where }: any = {}) => {
      if (!where) return collection.length
      return collection.filter(r => matchWhere(r, where)).length
    }),
  }
}

export function createMockPrisma() {
  const store: MockStore = {
    rawItems: [],
    articles: [],
    publications: [],
    members: [],
    inviteCodes: [],
    companies: [],
    articleCompanies: [],
    agentRoles: [],
    agentProcessLogs: [],
  }

  const prisma = {
    rawItem: createModel(store.rawItems, { status: 'new' }),
    article: createModel(store.articles, { status: 'draft' }),
    publication: createModel(store.publications),
    member: createModel(store.members, { level: 1 }),
    inviteCode: createModel(store.inviteCodes, { active: 1 }),
    company: createModel(store.companies, { mentionCount: 0 }),
    articleCompany: createModel(store.articleCompanies),
    agentRole: createModel(store.agentRoles),
    agentProcessLog: createModel(store.agentProcessLogs, { status: 'pending' }),
    $disconnect: vi.fn(),
  }

  return { prisma: prisma as any, store }
}
