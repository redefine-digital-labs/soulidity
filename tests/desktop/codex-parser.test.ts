import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { CodexParser } from '../../desktop/apps/desktop/src/main/soul-extraction/parsers/codex'

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

describe('CodexParser', () => {
  const cleanupDirs: string[] = []

  afterEach(() => {
    for (const dir of cleanupDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ignores malformed response_item entries without item payload', () => {
    const tmpDir = makeTempDir('codex-parser-')
    cleanupDirs.push(tmpDir)

    const sessionDir = path.join(tmpDir, 'sessions', 'session-1')
    fs.mkdirSync(sessionDir, { recursive: true })
    const filePath = path.join(sessionDir, 'history.jsonl')

    fs.writeFileSync(filePath, [
      JSON.stringify({ type: 'response_item' }),
      JSON.stringify({
        type: 'response_item',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'text', text: 'scan this repo' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        item: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
        },
      }),
    ].join('\n'))

    const parser = new CodexParser()

    expect(() => parser.parseSessionFile(filePath)).not.toThrow()

    const result = parser.parseSessionFile(filePath)
    expect(result?.sessionId).toBe('session-1')
    expect(result?.turns).toHaveLength(2)
    expect(result?.turns.map((turn) => turn.role)).toEqual(['user', 'assistant'])
  })

  it('ignores malformed content blocks inside message arrays', () => {
    const tmpDir = makeTempDir('codex-parser-')
    cleanupDirs.push(tmpDir)

    const sessionDir = path.join(tmpDir, 'sessions', 'session-2')
    fs.mkdirSync(sessionDir, { recursive: true })
    const filePath = path.join(sessionDir, 'history.jsonl')

    fs.writeFileSync(filePath, [
      JSON.stringify({
        type: 'response_item',
        item: {
          type: 'message',
          role: 'assistant',
          content: [undefined, { type: 'text', text: 'safe block' }],
        },
      }),
    ].join('\n'))

    const parser = new CodexParser()

    expect(() => parser.parseSessionFile(filePath)).not.toThrow()
    expect(parser.parseSessionFile(filePath)?.turns[0]?.textLength).toBe('safe block'.length)
  })
})
