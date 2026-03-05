import { describe, it, expect, beforeEach } from 'vitest'
import { createMockPrisma } from '../helpers/mock-prisma.js'
import { seedAgentRoles, createProcessLog, updateProcessLog, getProcessLogsForArticle } from '../../src/db/agent-roles.js'

describe('agent-roles db', () => {
  it('seedAgentRoles creates 5 roles if none exist', async () => {
    const { prisma, store } = createMockPrisma()
    await seedAgentRoles(prisma)
    expect(store.agentRoles.length).toBe(5)
    expect(store.agentRoles.map((r: any) => r.name)).toEqual([
      'scout', 'reporter', 'analyst', 'editor', 'publisher'
    ])
  })

  it('createProcessLog inserts a log entry', async () => {
    const { prisma, store } = createMockPrisma()
    await seedAgentRoles(prisma)
    const roleId = store.agentRoles[0].id
    const logId = await createProcessLog(prisma, {
      articleId: 'article-1',
      roleId,
    })
    expect(logId).toBeTruthy()
    expect(store.agentProcessLogs.length).toBe(1)
    expect(store.agentProcessLogs[0].status).toBe('pending')
  })

  it('updateProcessLog updates status and output', async () => {
    const { prisma, store } = createMockPrisma()
    await seedAgentRoles(prisma)
    const roleId = store.agentRoles[0].id
    const logId = await createProcessLog(prisma, {
      articleId: 'article-1',
      roleId,
    })
    await updateProcessLog(prisma, logId, {
      status: 'completed',
      output: '{"result": "test"}',
    })
    expect(store.agentProcessLogs[0].status).toBe('completed')
    expect(store.agentProcessLogs[0].output).toBe('{"result": "test"}')
  })
})
