import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusFile } from '../../desktop/packages/shared/src/types/cli-status'

const { broadcastSend } = vi.hoisted(() => ({
  broadcastSend: vi.fn(),
}))

function buildStatus(lastUpdated: number, sessionOverrides: Partial<AgentStatusFile['sessions'][string]> = {}): AgentStatusFile {
  return {
    version: 1,
    lastUpdated,
    sessions: {
      'session-1': {
        sessionId: 'session-1',
        clientType: 'claude-code',
        status: 'working',
        source: 'hook',
        startedAt: 1000,
        lastUpdated: 1500,
        ...sessionOverrides,
      },
    },
  }
}

describe('publishAgentStatus', () => {
  beforeEach(() => {
    vi.resetModules()
    broadcastSend.mockClear()
  })

  it('does not rebroadcast when only the root lastUpdated changes', async () => {
    const { publishAgentStatus } = await import('../../desktop/apps/desktop/src/main/status-watcher')

    publishAgentStatus(buildStatus(1000), { broadcast: broadcastSend })
    publishAgentStatus(buildStatus(1001), { broadcast: broadcastSend })

    expect(broadcastSend).toHaveBeenCalledTimes(1)
  })

  it('rebroadcasts when a visible session changes', async () => {
    const { publishAgentStatus } = await import('../../desktop/apps/desktop/src/main/status-watcher')

    publishAgentStatus(buildStatus(1000), { broadcast: broadcastSend })
    publishAgentStatus(buildStatus(1001, {
      status: 'needs-attention',
      needsAttention: 'Approve this change?',
      lastUpdated: 1600,
    }), { broadcast: broadcastSend })

    expect(broadcastSend).toHaveBeenCalledTimes(2)
  })
})
