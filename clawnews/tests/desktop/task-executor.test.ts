import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
}))

import { buildTaskPrompt, resolveCliCommand } from '../../desktop/apps/desktop/src/main/task-executor'

describe('task executor command resolution', () => {
  it('builds a read-only prompt and read-only Codex sandbox', () => {
    const prompt = buildTaskPrompt('Inspect the repo and summarize the risks.', ['src/index.ts'], 'read')
    expect(prompt).toContain('Read-only task')
    expect(prompt).toContain('src/index.ts')

    const cli = resolveCliCommand('codex', prompt, 'read')
    expect(cli.cmd).toBe('codex')
    expect(cli.args).toContain('read-only')
    expect(cli.args).toContain('--skip-git-repo-check')
    expect(cli.args).toContain('never')
  })

  it('keeps write-capable Claude runs behind explicit write tool permissions', () => {
    const prompt = buildTaskPrompt('Apply the requested fix.', ['app.ts'], 'write')
    const cli = resolveCliCommand('claude', prompt, 'write')

    expect(cli.cmd).toBe('claude')
    expect(cli.args).toContain('Bash,Read,Write,Edit')
    expect(cli.args).toContain('--dangerously-skip-permissions')
  })
})
