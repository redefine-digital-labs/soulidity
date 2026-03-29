import { describe, expect, it } from 'vitest'
import { resolveReviewMemoryConfigFromEnv } from '../../src/mcp/review-memory/config.js'

describe('resolveReviewMemoryConfigFromEnv', () => {
  it('prefers MEM9_* env vars over legacy MNEMO_* fallbacks', () => {
    const config = resolveReviewMemoryConfigFromEnv({
      MEM9_API_URL: 'http://mem9.example',
      MEM9_API_KEY: 'mem9-key',
      MNEMO_API_URL: 'http://legacy.example',
      MNEMO_TENANT_ID: 'legacy-key',
      REVIEW_MEMORY_REPO_ID: 'clawnews',
      REVIEW_MEMORY_AGENT_NAME: 'review-memory-mcp',
    })

    expect(config).toEqual({
      apiUrl: 'http://mem9.example',
      apiKey: 'mem9-key',
      repo: 'clawnews',
      agentName: 'review-memory-mcp',
      sources: {
        apiUrl: 'MEM9_API_URL',
        apiKey: 'MEM9_API_KEY',
        repo: 'REVIEW_MEMORY_REPO_ID',
        agentName: 'REVIEW_MEMORY_AGENT_NAME',
      },
    })
  })

  it('falls back to MNEMO_* env vars when MEM9_* are absent', () => {
    const config = resolveReviewMemoryConfigFromEnv({
      MNEMO_API_URL: 'http://legacy.example',
      MNEMO_TENANT_ID: 'legacy-key',
    }, '/tmp/alpha-project')

    expect(config.apiUrl).toBe('http://legacy.example')
    expect(config.apiKey).toBe('legacy-key')
    expect(config.repo).toBe('alpha-project')
    expect(config.sources.apiUrl).toBe('MNEMO_API_URL')
    expect(config.sources.apiKey).toBe('MNEMO_TENANT_ID')
    expect(config.sources.repo).toBe('derived')
  })

  it('derives repo id from the git root when cwd is inside a repository', () => {
    const config = resolveReviewMemoryConfigFromEnv({
      MEM9_API_URL: 'http://mem9.example',
      MEM9_API_KEY: 'mem9-key',
    }, `${process.cwd()}/tests/mcp`)

    expect(config.repo).toBe('clawnews')
    expect(config.sources.repo).toBe('derived')
  })
})
