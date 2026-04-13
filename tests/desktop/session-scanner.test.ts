import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('scanSessions', () => {
  const cleanupDirs: string[] = []

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    for (const dir of cleanupDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('continues scanning when one Codex file throws during parsing', async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-sessions-'))
    cleanupDirs.push(tmpHome)

    const badDir = path.join(tmpHome, '.codex', 'sessions', 'bad-session')
    const goodDir = path.join(tmpHome, '.codex', 'sessions', 'good-session')
    fs.mkdirSync(badDir, { recursive: true })
    fs.mkdirSync(goodDir, { recursive: true })

    const badFile = path.join(badDir, 'bad.jsonl')
    const goodFile = path.join(goodDir, 'good.jsonl')

    fs.writeFileSync(badFile, '{"type":"response_item"}\n')
    fs.writeFileSync(goodFile, [
      JSON.stringify({
        type: 'response_item',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'text', text: 'hello' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        item: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'world' }],
        },
      }),
    ].join('\n'))

    vi.doMock('node:os', async () => {
      const actual = await vi.importActual<typeof import('node:os')>('node:os')
      return { ...actual, homedir: () => tmpHome }
    })

    const { CodexParser } = await import('../../desktop/apps/desktop/src/main/soul-extraction/parsers/codex')
    const { scanSessions } = await import('../../desktop/apps/desktop/src/main/soul-extraction/session-scanner')
    const originalParse = CodexParser.prototype.parseSessionFile
    vi.spyOn(CodexParser.prototype, 'parseSessionFile').mockImplementation(function mockedParse(filePath) {
      if (filePath === badFile) {
        throw new Error('bad codex entry')
      }
      return originalParse.call(this, filePath)
    })

    const progressEvents: Array<{ phase: string; error?: string }> = []
    const results = await scanSessions({
      agentTypes: ['codex'],
      onProgress: (progress) => {
        progressEvents.push({ phase: progress.phase, error: progress.error })
      },
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.agentType).toBe('codex')
    expect(results[0]?.sessionCount).toBe(1)
    expect(progressEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'error', error: expect.stringContaining('bad codex entry') }),
      expect.objectContaining({ phase: 'complete' }),
    ]))
  })
})
