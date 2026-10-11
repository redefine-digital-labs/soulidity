import { describe, expect, it } from 'vitest'
import { getVisiblePetTasks, type AgentRuntimeSnapshot } from '../../desktop/packages/shared/src'

describe('pet task summaries', () => {
  it('carries task ids from runtime snapshots into visible task summaries', () => {
    const snapshot = {
      version: 1,
      lastUpdated: 100,
      transport: {
        status: 'ready',
        mode: 'unix-socket',
      },
      sessions: {
        'session-1': {
          sessionId: 'session-1',
          source: 'claude',
          clientType: 'claude-code',
          status: 'running',
          startedAt: 0,
          lastUpdated: 100,
          recentMessages: [],
          toolHistory: [],
          taskId: 'task-123',
        },
      },
      pendingPermissions: [],
      pendingQuestions: [],
      hooks: [],
    } as AgentRuntimeSnapshot

    expect(getVisiblePetTasks(snapshot)).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        taskId: 'task-123',
      }),
    ])
  })
})
