import { describe, it, expect, vi } from 'vitest'
import { runAgentPipeline } from '../../src/producer/pipeline.js'
import { createMockPrisma } from '../helpers/mock-prisma.js'

function createMockLLM(responses: string[]) {
  let callCount = 0
  return {
    generate: vi.fn(async (_system: string, _user: string) => {
      const response = responses[callCount] ?? responses[responses.length - 1]
      callCount++
      return response
    }),
  }
}

function seedAgentRoles(store: ReturnType<typeof createMockPrisma>['store']) {
  const roles = ['scout', 'reporter', 'analyst', 'editor', 'publisher']
  for (const [i, name] of roles.entries()) {
    store.agentRoles.push({
      id: `role-${name}`,
      name,
      label: name,
      sortOrder: i + 1,
      createdAt: new Date(),
    })
  }
}

describe('runAgentPipeline', () => {
  it('processes a raw item through reporter → analyst → editor', async () => {
    const { prisma, store } = createMockPrisma()

    seedAgentRoles(store)

    // Add a raw item
    store.rawItems.push({
      id: 'raw-1',
      sourceType: 'rss',
      sourceName: 'CoinDesk',
      title: 'Test News',
      url: 'https://example.com/test',
      content: 'Test content about crypto',
      language: 'en',
      score: 5,
      status: 'deduped',
      createdAt: new Date(),
    })

    const llm = createMockLLM([
      JSON.stringify({ title_zh: '测试标题', lead_zh: '据报道，测试' }),
      JSON.stringify({ body_zh: '深度分析内容', tags: ['Crypto'], companies: [] }),
      JSON.stringify({ title_zh: '最终标题', summary_zh: '最终摘要', analysis_zh: '最终分析', quality_score: 8, approved: true }),
    ])

    const result = await runAgentPipeline(prisma, llm, 'raw-1')

    expect(result.success).toBe(true)
    expect(result.articleId).toBeTruthy()
    expect(llm.generate).toHaveBeenCalledTimes(3) // reporter, analyst, editor
    expect(store.articles.length).toBe(1)
    expect(store.articles[0].titleZh).toBe('最终标题')
    expect(store.agentProcessLogs.every(log => log.articleId === result.articleId)).toBe(true)
    expect(store.agentProcessLogs.length).toBeGreaterThanOrEqual(3)
  })

  it('requeues the raw item when a transient DB error happens after processing starts', async () => {
    const { prisma, store } = createMockPrisma()
    seedAgentRoles(store)

    store.rawItems.push({
      id: 'raw-1',
      sourceType: 'rss',
      sourceName: 'CoinDesk',
      title: 'Test News',
      url: 'https://example.com/test',
      content: 'Test content about crypto',
      language: 'en',
      score: 5,
      status: 'deduped',
      createdAt: new Date(),
    })

    const llm = createMockLLM([
      JSON.stringify({ title_zh: '测试标题', lead_zh: '据报道，测试' }),
      JSON.stringify({ body_zh: '深度分析内容', tags: ['Crypto'], companies: [] }),
      JSON.stringify({ title_zh: '最终标题', summary_zh: '最终摘要', analysis_zh: '最终分析', quality_score: 8, approved: true }),
    ])

    prisma.article.update.mockImplementationOnce(async () => {
      const err: any = new Error('connection lost')
      err.code = '08006'
      throw err
    })

    const result = await runAgentPipeline(prisma, llm, 'raw-1')

    expect(result.success).toBe(false)
    expect(result.error).toContain('DB connection error')
    expect(store.rawItems[0].status).toBe('deduped')
  })

  it('returns error for non-existent raw item', async () => {
    const { prisma } = createMockPrisma()
    const llm = createMockLLM([])
    const result = await runAgentPipeline(prisma, llm, 'non-existent')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('passes review hints to the reporter without replacing the original tweet text', async () => {
    const { prisma, store } = createMockPrisma()
    seedAgentRoles(store)

    store.rawItems.push({
      id: 'raw-x-1',
      sourceType: 'x',
      sourceName: 'x:openclaw',
      title: 'Original tweet title',
      url: 'https://x.com/openclaw/status/1',
      content: 'Original tweet body with the source facts intact',
      language: 'en',
      score: 8,
      status: 'deduped',
      rawData: JSON.stringify({
        tweet_id: '1',
        author: 'openclaw',
        review: {
          title: '审核建议标题',
          summary: '审核建议摘要',
          reviewedAt: '2026-03-08T08:00:00.000Z',
        },
      }),
      createdAt: new Date(),
    })

    const llm = createMockLLM([
      JSON.stringify({ title_zh: '测试标题', lead_zh: '据 x:openclaw 消息，测试' }),
      JSON.stringify({ body_zh: '深度分析内容', tags: ['Crypto'], companies: [] }),
      JSON.stringify({ title_zh: '最终标题', summary_zh: '最终摘要', analysis_zh: '最终分析', quality_score: 8, approved: true }),
    ])

    const result = await runAgentPipeline(prisma, llm, 'raw-x-1')

    expect(result.success).toBe(true)
    expect(llm.generate).toHaveBeenCalledTimes(3)

    const reporterPrompt = llm.generate.mock.calls[0][1]
    expect(reporterPrompt).toContain('Original tweet body with the source facts intact')
    expect(reporterPrompt).toContain('审核建议标题')
    expect(reporterPrompt).toContain('审核建议摘要')
    expect(store.rawItems[0].content).toBe('Original tweet body with the source facts intact')
  })
})
