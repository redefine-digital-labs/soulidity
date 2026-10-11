import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getHookCoveredTypesFromStatuses } from '../../desktop/apps/desktop/src/main/agent-monitor'
import { getRuntimeHookStatuses } from '../../desktop/apps/desktop/src/main/agent-runtime-hooks'

function createNestedHookEntry(command: string) {
  return {
    hooks: [{
      type: 'command',
      command,
      timeout: 5,
    }],
  }
}

describe('agent monitor hook coverage', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-monitor-home-'))
    fs.mkdirSync(path.join(homeDir, '.soulidity', 'hooks'), { recursive: true })
    fs.writeFileSync(path.join(homeDir, '.soulidity', 'hooks', 'soulidity-hook.sh'), '#!/bin/sh\nexit 0\n', 'utf8')
  })

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true })
  })

  it('treats healthy Codex and OpenCode installs as hook-covered monitor clients', () => {
    fs.mkdirSync(path.join(homeDir, '.codex'), { recursive: true })
    const codexCommand = `/bin/sh '${path.join(homeDir, '.soulidity', 'hooks', 'soulidity-hook.sh')}' --source codex --event SessionStart`
    fs.writeFileSync(path.join(homeDir, '.codex', 'hooks.json'), JSON.stringify({
      hooks: {
        SessionStart: [createNestedHookEntry(codexCommand)],
        SessionEnd: [createNestedHookEntry(codexCommand)],
        UserPromptSubmit: [createNestedHookEntry(codexCommand)],
        PreToolUse: [createNestedHookEntry(codexCommand)],
        PostToolUse: [createNestedHookEntry(codexCommand)],
        Stop: [createNestedHookEntry(codexCommand)],
      },
    }, null, 2), 'utf8')
    fs.writeFileSync(path.join(homeDir, '.codex', 'config.toml'), '[features]\ncodex_hooks = true\n', 'utf8')

    const opencodePluginPath = path.join(homeDir, '.config', 'opencode', 'plugins', 'soulidity.js')
    fs.mkdirSync(path.dirname(opencodePluginPath), { recursive: true })
    fs.writeFileSync(opencodePluginPath, '// version: v1\n', 'utf8')
    fs.writeFileSync(path.join(homeDir, '.config', 'opencode', 'opencode.json'), JSON.stringify({
      plugin: [`file://${opencodePluginPath}`],
    }, null, 2), 'utf8')

    const statuses = getRuntimeHookStatuses({ homeDir })
    const covered = getHookCoveredTypesFromStatuses(statuses)

    expect(covered.has('codex')).toBe(true)
    expect(covered.has('opencode')).toBe(true)
  })
})
