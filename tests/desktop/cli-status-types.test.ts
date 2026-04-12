import { describe, it, expect } from 'vitest'
import {
  parseAgentStatusFile,
  deriveAggregateStatus,
  type AgentStatusFile,
} from '../../desktop/packages/shared/src/types/cli-status'

describe('parseAgentStatusFile', () => {
  it('accepts valid file with sessions', () => {
    const valid: AgentStatusFile = {
      version: 1,
      lastUpdated: Date.now(),
      sessions: {
        'sess-1': {
          sessionId: 'sess-1',
          clientType: 'claude-code',
          status: 'working',
          startedAt: 1000,
          lastUpdated: 2000,
        },
        'sess-2': {
          sessionId: 'sess-2',
          clientType: 'codex',
          status: 'completed',
          startedAt: 1500,
          lastUpdated: 2500,
          endedAt: 2500,
          sessionTitle: 'Fix a bug',
        },
      },
    }

    const result = parseAgentStatusFile(JSON.stringify(valid))
    expect(result).not.toBeNull()
    expect(result!.version).toBe(1)
    expect(Object.keys(result!.sessions)).toHaveLength(2)
    expect(result!.sessions['sess-1'].status).toBe('working')
    expect(result!.sessions['sess-2'].clientType).toBe('codex')
  })

  it('accepts valid file with currentAction', () => {
    const valid: AgentStatusFile = {
      version: 1,
      lastUpdated: Date.now(),
      sessions: {
        's1': {
          sessionId: 's1',
          clientType: 'claude-code',
          status: 'working',
          startedAt: 1000,
          lastUpdated: 2000,
          currentAction: {
            tool: 'Read',
            details: 'index.ts',
            timestamp: 2000,
          },
        },
      },
    }
    const result = parseAgentStatusFile(JSON.stringify(valid))
    expect(result).not.toBeNull()
    expect(result!.sessions['s1'].currentAction!.tool).toBe('Read')
  })

  it('rejects invalid version', () => {
    const bad = {
      version: 2,
      lastUpdated: Date.now(),
      sessions: {},
    }
    expect(parseAgentStatusFile(JSON.stringify(bad))).toBeNull()
  })

  it('rejects missing version', () => {
    const bad = { lastUpdated: Date.now(), sessions: {} }
    expect(parseAgentStatusFile(JSON.stringify(bad))).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parseAgentStatusFile('not json at all')).toBeNull()
    expect(parseAgentStatusFile('')).toBeNull()
    expect(parseAgentStatusFile('{]')).toBeNull()
  })

  it('rejects session with invalid status', () => {
    const bad = {
      version: 1,
      lastUpdated: Date.now(),
      sessions: {
        s1: {
          sessionId: 's1',
          clientType: 'claude-code',
          status: 'unknown-status',
          startedAt: 1000,
          lastUpdated: 2000,
        },
      },
    }
    expect(parseAgentStatusFile(JSON.stringify(bad))).toBeNull()
  })

  it('rejects session with invalid clientType', () => {
    const bad = {
      version: 1,
      lastUpdated: Date.now(),
      sessions: {
        s1: {
          sessionId: 's1',
          clientType: 'vscode',
          status: 'idle',
          startedAt: 1000,
          lastUpdated: 2000,
        },
      },
    }
    expect(parseAgentStatusFile(JSON.stringify(bad))).toBeNull()
  })

  it('rejects session missing required fields', () => {
    const bad = {
      version: 1,
      lastUpdated: Date.now(),
      sessions: {
        s1: {
          sessionId: 's1',
          // missing clientType, status, startedAt, lastUpdated
        },
      },
    }
    expect(parseAgentStatusFile(JSON.stringify(bad))).toBeNull()
  })

  it('rejects non-object input', () => {
    expect(parseAgentStatusFile('"hello"')).toBeNull()
    expect(parseAgentStatusFile('42')).toBeNull()
    expect(parseAgentStatusFile('null')).toBeNull()
  })
})

describe('deriveAggregateStatus', () => {
  it('picks most-recent non-ended session', () => {
    const file: AgentStatusFile = {
      version: 1,
      lastUpdated: 3000,
      sessions: {
        old: {
          sessionId: 'old',
          clientType: 'claude-code',
          status: 'working',
          startedAt: 1000,
          lastUpdated: 1500,
        },
        recent: {
          sessionId: 'recent',
          clientType: 'codex',
          status: 'needs-attention',
          startedAt: 2000,
          lastUpdated: 3000,
        },
      },
    }
    expect(deriveAggregateStatus(file)).toBe('needs-attention')
  })

  it('ignores ended sessions and picks active', () => {
    const file: AgentStatusFile = {
      version: 1,
      lastUpdated: 5000,
      sessions: {
        ended: {
          sessionId: 'ended',
          clientType: 'claude-code',
          status: 'error',
          startedAt: 1000,
          lastUpdated: 5000,
          endedAt: 5000,
        },
        active: {
          sessionId: 'active',
          clientType: 'codex',
          status: 'thinking',
          startedAt: 2000,
          lastUpdated: 3000,
        },
      },
    }
    expect(deriveAggregateStatus(file)).toBe('thinking')
  })

  it('returns idle when all sessions ended', () => {
    const file: AgentStatusFile = {
      version: 1,
      lastUpdated: 3000,
      sessions: {
        a: {
          sessionId: 'a',
          clientType: 'claude-code',
          status: 'completed',
          startedAt: 1000,
          lastUpdated: 2000,
          endedAt: 2000,
        },
        b: {
          sessionId: 'b',
          clientType: 'codex',
          status: 'error',
          startedAt: 1500,
          lastUpdated: 3000,
          endedAt: 3000,
        },
      },
    }
    expect(deriveAggregateStatus(file)).toBe('idle')
  })

  it('returns idle when no sessions exist', () => {
    const file: AgentStatusFile = {
      version: 1,
      lastUpdated: 1000,
      sessions: {},
    }
    expect(deriveAggregateStatus(file)).toBe('idle')
  })
})
