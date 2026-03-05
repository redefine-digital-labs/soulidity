import type { PrismaClient } from './database.js'

const ROLES = [
  { name: 'scout', label: '侦察员 Scout', description: '源头采集、去重、评分', sortOrder: 1 },
  { name: 'reporter', label: '记者 Reporter', description: '摘要撰写、翻译', sortOrder: 2 },
  { name: 'analyst', label: '分析师 Analyst', description: '深度解读、关联分析', sortOrder: 3 },
  { name: 'editor', label: '编辑 Editor', description: '质量审核、终稿把关', sortOrder: 4 },
  { name: 'publisher', label: '发行员 Publisher', description: '多渠道分发', sortOrder: 5 },
]

export async function seedAgentRoles(prisma: PrismaClient): Promise<void> {
  for (const role of ROLES) {
    await prisma.agentRole.upsert({
      where: { name: role.name },
      create: role,
      update: {},
    })
  }
}

export async function getRoleByName(prisma: PrismaClient, name: string) {
  return prisma.agentRole.findUnique({ where: { name } })
}

export async function createProcessLog(
  prisma: PrismaClient,
  data: { articleId: string; roleId: string }
): Promise<string> {
  const row = await prisma.agentProcessLog.create({
    data: {
      articleId: data.articleId,
      roleId: data.roleId,
      status: 'pending',
    },
  })
  return row.id
}

export async function updateProcessLog(
  prisma: PrismaClient,
  id: string,
  fields: { status?: string; input?: string; output?: string; startedAt?: Date; completedAt?: Date }
): Promise<void> {
  const data: Record<string, unknown> = {}
  if (fields.status !== undefined) data.status = fields.status
  if (fields.input !== undefined) data.input = fields.input
  if (fields.output !== undefined) data.output = fields.output
  if (fields.startedAt !== undefined) data.startedAt = fields.startedAt
  if (fields.completedAt !== undefined) data.completedAt = fields.completedAt
  await prisma.agentProcessLog.update({ where: { id }, data })
}

export async function getProcessLogsForArticle(prisma: PrismaClient, articleId: string) {
  return prisma.agentProcessLog.findMany({
    where: { articleId },
    include: { role: true },
    orderBy: { createdAt: 'asc' },
  })
}
