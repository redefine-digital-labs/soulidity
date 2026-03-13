import { vi } from 'vitest'

interface MockStore {
  rawItems: any[]
  collectorStates: any[]
  articles: any[]
  publications: any[]
  members: any[]
  inviteCodes: any[]
  companies: any[]
  articleCompanies: any[]
  agentRoles: any[]
  agentProcessLogs: any[]
  categories: any[]
  directions: any[]
  posts: any[]
  comments: any[]
  achievements: any[]
  memberAchievements: any[]
}

function matchWhere(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (v === null || v === undefined) {
      return row[k] === null || row[k] === undefined
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('in' in v) {
        return Array.isArray(v.in) && v.in.includes(row[k])
      }
      if ('gte' in v && row[k] < v.gte) {
        return false
      }
      if ('gt' in v && row[k] <= v.gt) {
        return false
      }
      if ('lte' in v && row[k] > v.lte) {
        return false
      }
      if ('lt' in v && row[k] >= v.lt) {
        return false
      }
      return true
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

function createModel(collection: any[], defaults: Record<string, any> = {}, uniqueKeys: string[] = []) {
  return {
    create: vi.fn(async ({ data }: any) => {
      if (uniqueKeys.some((key) => collection.some((row) => row[key] === data[key]))) {
        const err: any = new Error('Unique constraint failed')
        err.code = 'P2002'
        throw err
      }
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
    collectorStates: [],
    articles: [],
    publications: [],
    members: [],
    inviteCodes: [],
    companies: [],
    articleCompanies: [],
    agentRoles: [],
    agentProcessLogs: [],
    categories: [],
    directions: [],
    posts: [],
    comments: [],
    achievements: [],
    memberAchievements: [],
  }

  const prisma = {
    rawItem: createModel(store.rawItems, { status: 'new' }, ['url']),
    collectorState: createModel(store.collectorStates, {}, ['source']),
    article: createModel(store.articles, { status: 'draft' }),
    publication: createModel(store.publications),
    member: createModel(store.members, { level: 1 }),
    inviteCode: createModel(store.inviteCodes, { active: 1 }),
    company: createModel(store.companies, { mentionCount: 0 }),
    articleCompany: createModel(store.articleCompanies),
    agentRole: createModel(store.agentRoles),
    agentProcessLog: createModel(store.agentProcessLogs, { status: 'pending' }),
    category: createModel(store.categories),
    direction: createModel(store.directions, { status: 'active', userCount: 0, rating: 0, featured: false }),
    post: createModel(store.posts, { status: 'published', likeCount: 0, commentCount: 0 }),
    comment: createModel(store.comments),
    achievement: createModel(store.achievements),
    memberAchievement: createModel(store.memberAchievements),
    $disconnect: vi.fn(),
  }

  return { prisma: prisma as any, store }
}
