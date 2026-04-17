import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusFile } from '../../desktop/packages/shared/src/types/cli-status'
import { createCompatMirrorWriter } from '../../desktop/apps/desktop/src/main/compat-mirror-writer'

function buildStatus(lastUpdated: number): AgentStatusFile {
  return {
    version: 1,
    lastUpdated,
    sessions: {},
  }
}

describe('compat mirror writer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces rapid updates into one trailing write of the latest payload', () => {
    vi.useFakeTimers()
    const write = vi.fn()
    const writer = createCompatMirrorWriter({ delayMs: 200, write })

    writer.schedule(buildStatus(1))
    writer.schedule(buildStatus(2))

    expect(write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(199)
    expect(write).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenLastCalledWith(buildStatus(2))
  })

  it('flushes a pending payload immediately', () => {
    vi.useFakeTimers()
    const write = vi.fn()
    const writer = createCompatMirrorWriter({ delayMs: 200, write })

    writer.schedule(buildStatus(3))
    writer.flush()

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenLastCalledWith(buildStatus(3))

    vi.advanceTimersByTime(200)
    expect(write).toHaveBeenCalledTimes(1)
  })
})
