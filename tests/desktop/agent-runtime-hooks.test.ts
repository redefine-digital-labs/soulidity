import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentRuntimeHookManager } from '../../desktop/apps/desktop/src/main/agent-runtime-hooks'

describe('AgentRuntimeHookManager', () => {
  let homeDir: string
  let resourcesDir: string

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-hooks-home-'))
    resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-hooks-res-'))
    fs.writeFileSync(path.join(resourcesDir, 'soulidity-hook.sh'), '#!/bin/sh\nexit 0\n', 'utf8')
    fs.writeFileSync(path.join(resourcesDir, 'soulidity-opencode-plugin.js'), '// version: v1\n', 'utf8')
  })

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true })
    fs.rmSync(resourcesDir, { recursive: true, force: true })
  })

  it('refuses to rewrite commented JSON configs and leaves managed resources untouched', () => {
    fs.mkdirSync(path.join(homeDir, '.cursor'), { recursive: true })
    const configPath = path.join(homeDir, '.cursor', 'hooks.json')
    fs.writeFileSync(configPath, '{\n  // keep my notes\n  "hooks": {}\n}\n', 'utf8')

    const manager = new AgentRuntimeHookManager({
      homeDir,
      resourcesDir,
    })

    expect(() => manager.installHooks(['cursor'])).toThrow(/Refusing to rewrite commented JSON config/)
    expect(fs.readFileSync(configPath, 'utf8')).toContain('// keep my notes')
    expect(fs.existsSync(path.join(homeDir, '.soulidity', 'hooks', 'soulidity-hook.sh'))).toBe(false)
  })

  it('refuses to rewrite invalid JSON configs with syntax errors', () => {
    fs.mkdirSync(path.join(homeDir, '.cursor'), { recursive: true })
    const configPath = path.join(homeDir, '.cursor', 'hooks.json')
    fs.writeFileSync(configPath, '{\n  "theme": "dark",\n}\n', 'utf8')

    const manager = new AgentRuntimeHookManager({
      homeDir,
      resourcesDir,
    })

    expect(() => manager.installHooks(['cursor'])).toThrow(/Refusing to rewrite invalid JSON config/)
    expect(fs.readFileSync(configPath, 'utf8')).toContain('"theme": "dark",')
    expect(fs.existsSync(path.join(homeDir, '.soulidity', 'hooks', 'soulidity-hook.sh'))).toBe(false)
  })

  it('refuses to rewrite invalid OpenCode configs before copying plugin assets', () => {
    fs.mkdirSync(path.join(homeDir, '.config', 'opencode'), { recursive: true })
    const configPath = path.join(homeDir, '.config', 'opencode', 'opencode.json')
    fs.writeFileSync(configPath, '{\n  "plugin": [\n    "file:///tmp/legacy.js",\n  ]\n}\n', 'utf8')

    const manager = new AgentRuntimeHookManager({
      homeDir,
      resourcesDir,
    })

    expect(() => manager.installHooks(['opencode'])).toThrow(/Refusing to rewrite invalid JSON config/)
    expect(fs.readFileSync(configPath, 'utf8')).toContain('"file:///tmp/legacy.js",')
    expect(fs.existsSync(path.join(homeDir, '.config', 'opencode', 'plugins', 'soulidity.js'))).toBe(false)
    expect(fs.existsSync(path.join(homeDir, '.soulidity', 'hooks', 'soulidity-hook.sh'))).toBe(false)
  })

  it('removes the managed hook script when uninstalling the last integration', () => {
    fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(homeDir, '.claude', 'settings.json'), '{}\n', 'utf8')

    const manager = new AgentRuntimeHookManager({
      homeDir,
      resourcesDir,
    })

    manager.installHooks(['claude'])
    const managedHookPath = path.join(homeDir, '.soulidity', 'hooks', 'soulidity-hook.sh')
    expect(fs.existsSync(managedHookPath)).toBe(true)

    manager.uninstallHooks(['claude'])

    expect(fs.existsSync(managedHookPath)).toBe(false)
  })
})
