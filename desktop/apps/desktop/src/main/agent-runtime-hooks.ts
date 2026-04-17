import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { HookInstallStatus, SupportedAgentSource } from '@soulidity/shared'

type HookFormat = 'claude' | 'nested' | 'flat' | 'copilot' | 'kimi'

interface HookRegistryEntry {
  source: SupportedAgentSource
  label: string
  configPath: string
  configKey: string
  format: HookFormat
  events: readonly string[]
  commandSource?: string
}

interface HookManagerOptions {
  homeDir?: string
  resourcesDir: string
}

const HOOK_MARKER = 'soulidity-hook.sh'
const OPENCODE_PLUGIN_MARKER = 'soulidity'
const OPENCODE_PLUGIN_VERSION = 'v1'
const BLOCKING_HOOK_TIMEOUT_SECONDS = 86400

const DEFAULT_CLAUDE_EVENTS = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'Notification',
  'PreCompact',
]

const REGISTRY: readonly HookRegistryEntry[] = [
  {
    label: 'Claude Code',
    source: 'claude',
    configPath: '.claude/settings.json',
    configKey: 'hooks',
    format: 'claude',
    events: DEFAULT_CLAUDE_EVENTS,
  },
  {
    label: 'Codex',
    source: 'codex',
    configPath: '.codex/hooks.json',
    configKey: 'hooks',
    format: 'nested',
    events: ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'],
  },
  {
    label: 'Gemini CLI',
    source: 'gemini',
    configPath: '.gemini/settings.json',
    configKey: 'hooks',
    format: 'nested',
    events: ['SessionStart', 'SessionEnd', 'BeforeTool', 'AfterTool', 'BeforeAgent', 'AfterAgent'],
  },
  {
    label: 'Cursor',
    source: 'cursor',
    configPath: '.cursor/hooks.json',
    configKey: 'hooks',
    format: 'flat',
    events: [
      'beforeSubmitPrompt',
      'beforeShellExecution',
      'afterShellExecution',
      'beforeReadFile',
      'afterFileEdit',
      'beforeMCPExecution',
      'afterMCPExecution',
      'afterAgentThought',
      'afterAgentResponse',
      'stop',
    ],
  },
  {
    label: 'Trae',
    source: 'trae',
    configPath: '.trae/hooks.json',
    configKey: 'hooks',
    format: 'flat',
    events: [
      'beforeSubmitPrompt',
      'beforeShellExecution',
      'afterShellExecution',
      'beforeReadFile',
      'afterFileEdit',
      'beforeMCPExecution',
      'afterMCPExecution',
      'afterAgentThought',
      'afterAgentResponse',
      'stop',
    ],
  },
  {
    label: 'Trae CN',
    source: 'traecn',
    configPath: '.trae-cn/hooks.json',
    configKey: 'hooks',
    format: 'flat',
    events: [
      'beforeSubmitPrompt',
      'beforeShellExecution',
      'afterShellExecution',
      'beforeReadFile',
      'afterFileEdit',
      'beforeMCPExecution',
      'afterMCPExecution',
      'afterAgentThought',
      'afterAgentResponse',
      'stop',
    ],
  },
  {
    label: 'Qoder',
    source: 'qoder',
    configPath: '.qoder/settings.json',
    configKey: 'hooks',
    format: 'claude',
    events: DEFAULT_CLAUDE_EVENTS,
  },
  {
    label: 'Factory',
    source: 'droid',
    configPath: '.factory/settings.json',
    configKey: 'hooks',
    format: 'claude',
    events: DEFAULT_CLAUDE_EVENTS,
  },
  {
    label: 'CodeBuddy',
    source: 'codebuddy',
    configPath: '.codebuddy/settings.json',
    configKey: 'hooks',
    format: 'claude',
    events: DEFAULT_CLAUDE_EVENTS,
  },
  {
    label: 'CodyBuddyCN',
    source: 'codybuddycn',
    configPath: '.codybuddycn/settings.json',
    configKey: 'hooks',
    format: 'claude',
    events: DEFAULT_CLAUDE_EVENTS,
  },
  {
    label: 'StepFun',
    source: 'stepfun',
    configPath: '.stepfun/settings.json',
    configKey: 'hooks',
    format: 'claude',
    events: DEFAULT_CLAUDE_EVENTS,
  },
  {
    label: 'AntiGravity',
    source: 'antigravity',
    configPath: '.antigravity/settings.json',
    configKey: 'hooks',
    format: 'claude',
    events: DEFAULT_CLAUDE_EVENTS,
  },
  {
    label: 'WorkBuddy',
    source: 'workbuddy',
    configPath: '.workbuddy/settings.json',
    configKey: 'hooks',
    format: 'claude',
    events: DEFAULT_CLAUDE_EVENTS,
  },
  {
    label: 'Hermes',
    source: 'hermes',
    configPath: '.hermes/settings.json',
    configKey: 'hooks',
    format: 'claude',
    events: DEFAULT_CLAUDE_EVENTS,
  },
  {
    label: 'GitHub Copilot',
    source: 'copilot',
    configPath: '.copilot/hooks/soulidity.json',
    configKey: 'hooks',
    format: 'copilot',
    events: ['sessionStart', 'sessionEnd', 'userPromptSubmitted', 'preToolUse', 'postToolUse', 'errorOccurred'],
  },
  {
    label: 'Kimi Code CLI',
    source: 'kimi',
    configPath: '.kimi/config.toml',
    configKey: 'hooks',
    format: 'kimi',
    events: [
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'Stop',
      'SubagentStart',
      'SubagentStop',
      'SessionStart',
      'SessionEnd',
      'Notification',
      'PreCompact',
    ],
  },
]

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function scanJsonDocument(input: string): { stripped: string; hasComments: boolean } {
  let result = ''
  let i = 0
  let hasComments = false
  while (i < input.length) {
    const char = input[i]
    const next = input[i + 1]
    if (char === '"') {
      result += char
      i += 1
      while (i < input.length) {
        const current = input[i]
        result += current
        if (current === '\\') {
          i += 1
          if (i < input.length) result += input[i]
        } else if (current === '"') {
          break
        }
        i += 1
      }
      i += 1
      continue
    }
    if (char === '/' && next === '/') {
      hasComments = true
      i += 2
      while (i < input.length && input[i] !== '\n') i += 1
      continue
    }
    if (char === '/' && next === '*') {
      hasComments = true
      i += 2
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    result += char
    i += 1
  }
  return { stripped: result, hasComments }
}

function stripJsonComments(input: string): string {
  return scanJsonDocument(input).stripped
}

function assertSafeJsonRewrite(filePath: string): void {
  if (!fs.existsSync(filePath)) return
  const raw = fs.readFileSync(filePath, 'utf8')
  if (raw.trim().length === 0) return

  const { stripped, hasComments } = scanJsonDocument(raw)
  if (hasComments) {
    throw new Error(
      `Refusing to rewrite commented JSON config at ${filePath}. `
      + 'Soulidity skips commented JSON during Install/Repair/Uninstall so it does not erase your notes.',
    )
  }

  try {
    JSON.parse(stripped)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown JSON parse error'
    throw new Error(
      `Refusing to rewrite invalid JSON config at ${filePath}. `
      + 'Fix the syntax error before using Install/Repair/Uninstall so Soulidity does not erase your other settings. '
      + `Parser error: ${message}`,
    )
  }
}

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {}
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(stripJsonComments(raw)) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeJsonFile(filePath: string, value: Record<string, unknown>): void {
  assertSafeJsonRewrite(filePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function containsOurHook(entry: Record<string, unknown>): boolean {
  const command = typeof entry.command === 'string' ? entry.command : ''
  const bash = typeof entry.bash === 'string' ? entry.bash : ''
  if (command.includes(HOOK_MARKER) || bash.includes(HOOK_MARKER)) return true

  const hooks = Array.isArray(entry.hooks) ? entry.hooks : []
  return hooks.some((hook) => typeof hook === 'object'
    && hook !== null
    && typeof (hook as Record<string, unknown>).command === 'string'
    && ((hook as Record<string, unknown>).command as string).includes(HOOK_MARKER))
}

function removeManagedHookEntries(hooks: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {}
  for (const [eventName, value] of Object.entries(hooks)) {
    if (!Array.isArray(value)) {
      cleaned[eventName] = value
      continue
    }
    const remaining = value.filter((entry) => !(typeof entry === 'object' && entry !== null && containsOurHook(entry as Record<string, unknown>)))
    if (remaining.length > 0) cleaned[eventName] = remaining
  }
  return cleaned
}

function buildManagedHookCommand(managedHookPath: string, source: string, eventName: string): string {
  return `/bin/sh ${shellQuote(managedHookPath)} --source ${source} --event ${eventName}`
}

function defaultManagedDir(homeDir: string): string {
  return path.join(homeDir, '.soulidity', 'hooks')
}

function copyExecutable(sourcePath: string, targetPath: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.copyFileSync(sourcePath, targetPath)
  fs.chmodSync(targetPath, 0o755)
}

function detectRootForEntry(homeDir: string, entry: HookRegistryEntry): string {
  if (entry.source === 'copilot') return path.join(homeDir, '.copilot')
  if (entry.source === 'kimi') return path.join(homeDir, '.kimi')
  return path.join(homeDir, path.dirname(entry.configPath))
}

function removeKimiHooks(contents: string): string {
  const lines = contents.split('\n')
  const result: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (line.trim() === '[[hooks]]') {
      const block: string[] = [line]
      let next = index + 1
      while (next < lines.length) {
        const trimmed = lines[next].trim()
        if (trimmed.startsWith('[[') || (trimmed.startsWith('[') && trimmed !== '[[hooks]]')) break
        block.push(lines[next])
        next += 1
      }
      if (!block.join('\n').includes(HOOK_MARKER)) {
        result.push(...block)
      }
      index = next
      continue
    }
    result.push(line)
    index += 1
  }

  while (result.length > 0 && result[result.length - 1].trim() === '') {
    result.pop()
  }
  return result.join('\n')
}

export class AgentRuntimeHookManager {
  private readonly homeDir: string
  private readonly resourcesDir: string
  private readonly managedDir: string
  private readonly managedHookPath: string
  private readonly managedOpencodePluginPath: string

  constructor(options: HookManagerOptions) {
    this.homeDir = options.homeDir ?? os.homedir()
    this.resourcesDir = options.resourcesDir
    this.managedDir = defaultManagedDir(this.homeDir)
    this.managedHookPath = path.join(this.managedDir, 'soulidity-hook.sh')
    this.managedOpencodePluginPath = path.join(this.homeDir, '.config', 'opencode', 'plugins', 'soulidity.js')
  }

  getStatuses(): HookInstallStatus[] {
    const statuses = REGISTRY.map((entry) => this.getCliStatus(entry))
    statuses.push(this.getOpenCodeStatus())
    return statuses
  }

  installHooks(targets?: SupportedAgentSource[]): HookInstallStatus[] {
    this.assertWritableTargets(targets, 'install')
    this.installManagedResources()
    for (const entry of REGISTRY) {
      if (targets && !targets.includes(entry.source)) continue
      if (!this.isDetected(entry)) continue
      this.installCliHooks(entry)
    }
    if (!targets || targets.includes('opencode')) {
      this.installOpencodePlugin()
    }
    return this.getStatuses()
  }

  repairHooks(targets?: SupportedAgentSource[]): HookInstallStatus[] {
    return this.installHooks(targets)
  }

  uninstallHooks(targets?: SupportedAgentSource[]): HookInstallStatus[] {
    this.assertWritableTargets(targets, 'uninstall')
    for (const entry of REGISTRY) {
      if (targets && !targets.includes(entry.source)) continue
      if (!this.isInstalled(entry)) continue
      this.uninstallCliHooks(entry)
    }
    if ((!targets || targets.includes('opencode')) && this.isOpenCodeInstalled()) {
      this.uninstallOpencodePlugin()
    }
    this.cleanupManagedResourcesIfUnused()
    return this.getStatuses()
  }

  private installManagedResources(): void {
    const shellResourcePath = path.join(this.resourcesDir, 'soulidity-hook.sh')
    copyExecutable(shellResourcePath, this.managedHookPath)
  }

  private getCliStatus(entry: HookRegistryEntry): HookInstallStatus {
    const detected = this.isDetected(entry)
    const installed = detected && this.isInstalled(entry)
    const healthy = installed && fs.existsSync(this.managedHookPath)
    return {
      source: entry.source,
      label: entry.label,
      detected,
      installed,
      healthy,
      configPath: path.join(this.homeDir, entry.configPath),
      error: detected && installed && !healthy ? 'Managed hook resource missing or outdated' : undefined,
    }
  }

  private getOpenCodeStatus(): HookInstallStatus {
    const detected = fs.existsSync(path.join(this.homeDir, '.config', 'opencode'))
    const installed = detected && this.isOpenCodeInstalled()
    const healthy = installed
      && fs.existsSync(this.managedHookPath)
      && fs.existsSync(this.managedOpencodePluginPath)
    return {
      source: 'opencode',
      label: 'OpenCode',
      detected,
      installed,
      healthy,
      configPath: path.join(this.homeDir, '.config', 'opencode', 'opencode.json'),
      error: detected && installed && !healthy ? 'OpenCode plugin or managed hook resource missing' : undefined,
    }
  }

  private assertWritableTargets(targets?: SupportedAgentSource[], mode: 'install' | 'uninstall' = 'install'): void {
    for (const entry of REGISTRY) {
      if (targets && !targets.includes(entry.source)) continue
      if (entry.format === 'kimi') continue
      if (mode === 'install' && !this.isDetected(entry)) continue
      if (mode === 'uninstall' && !this.isInstalled(entry)) continue
      assertSafeJsonRewrite(path.join(this.homeDir, entry.configPath))
    }

    if ((!targets || targets.includes('opencode')) && (mode === 'install' || this.isOpenCodeInstalled())) {
      for (const configPath of [
        path.join(this.homeDir, '.config', 'opencode', 'opencode.json'),
        path.join(this.homeDir, '.config', 'opencode', 'config.json'),
      ]) {
        assertSafeJsonRewrite(configPath)
      }
    }
  }

  private cleanupManagedResourcesIfUnused(): void {
    const statuses = this.getStatuses()
    if (statuses.some((status) => status.installed)) return

    if (fs.existsSync(this.managedHookPath)) {
      fs.rmSync(this.managedHookPath, { force: true })
    }

    if (fs.existsSync(this.managedDir) && fs.readdirSync(this.managedDir).length === 0) {
      fs.rmdirSync(this.managedDir)
    }
  }

  private isDetected(entry: HookRegistryEntry): boolean {
    const root = detectRootForEntry(this.homeDir, entry)
    if (entry.source === 'kimi') {
      return fs.existsSync(root) || fs.existsSync(path.join(root, 'sessions'))
    }
    return fs.existsSync(root)
  }

  private isInstalled(entry: HookRegistryEntry): boolean {
    if (entry.format === 'kimi') {
      return this.isKimiInstalled(entry)
    }
    if (entry.source === 'codex' && !this.isCodexHooksEnabled()) {
      return false
    }
    const root = readJsonFile(path.join(this.homeDir, entry.configPath))
    const hooksRoot = root[entry.configKey]
    if (typeof hooksRoot !== 'object' || hooksRoot === null) return false
    const hooks = hooksRoot as Record<string, unknown>
    return entry.events.every((eventName) => {
      const entries = hooks[eventName]
      if (!Array.isArray(entries)) return false
      return entries.some((entryValue) => typeof entryValue === 'object'
        && entryValue !== null
        && containsOurHook(entryValue as Record<string, unknown>))
    })
  }

  private isKimiInstalled(entry: HookRegistryEntry): boolean {
    const configPath = path.join(this.homeDir, entry.configPath)
    if (!fs.existsSync(configPath)) return false
    const contents = fs.readFileSync(configPath, 'utf8')
    return entry.events.every((eventName) => contents.includes(`event = "${eventName}"`) && contents.includes(HOOK_MARKER))
  }

  private isCodexHooksEnabled(): boolean {
    const configPath = path.join(this.homeDir, '.codex', 'config.toml')
    if (!fs.existsSync(configPath)) return false
    const contents = fs.readFileSync(configPath, 'utf8')
    return /^\s*codex_hooks\s*=\s*true\s*$/m.test(contents)
  }

  private installCliHooks(entry: HookRegistryEntry): void {
    if (entry.format === 'kimi') {
      this.installKimiHooks(entry)
      return
    }

    const configPath = path.join(this.homeDir, entry.configPath)
    const root = readJsonFile(configPath)
    const existingHooks = typeof root[entry.configKey] === 'object' && root[entry.configKey] !== null
      ? root[entry.configKey] as Record<string, unknown>
      : {}
    const hooks = removeManagedHookEntries(existingHooks)

    for (const eventName of entry.events) {
      const command = buildManagedHookCommand(this.managedHookPath, entry.commandSource ?? entry.source, eventName)
      const currentEntries = Array.isArray(hooks[eventName]) ? hooks[eventName] as Record<string, unknown>[] : []
      const entryValue = this.buildHookEntry(entry.format, command, eventName)
      currentEntries.push(entryValue)
      hooks[eventName] = currentEntries
    }

    root[entry.configKey] = hooks
    if (entry.format === 'copilot') {
      root.version = 1
    }
    writeJsonFile(configPath, root)

    if (entry.source === 'codex') {
      this.enableCodexHooksConfig()
    }
  }

  private buildHookEntry(format: HookFormat, command: string, eventName: string): Record<string, unknown> {
    switch (format) {
      case 'claude':
        return {
          matcher: '',
          hooks: [{
            type: 'command',
            command,
            timeout: eventName === 'Notification'
              ? BLOCKING_HOOK_TIMEOUT_SECONDS
              : eventName === 'PermissionRequest'
                ? BLOCKING_HOOK_TIMEOUT_SECONDS
                : 5,
          }],
        }
      case 'nested':
        return {
          hooks: [{
            type: 'command',
            command,
            timeout: 5,
          }],
        }
      case 'flat':
        return { command }
      case 'copilot':
        return {
          type: 'command',
          bash: command,
          timeoutSec: 5,
        }
      case 'kimi':
        return {}
    }
  }

  private installKimiHooks(entry: HookRegistryEntry): void {
    const configPath = path.join(this.homeDir, entry.configPath)
    let contents = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : ''
    contents = removeKimiHooks(contents)
    const blocks = entry.events.map((eventName) => {
      const command = buildManagedHookCommand(this.managedHookPath, entry.commandSource ?? entry.source, eventName)
      const lines = [
        '[[hooks]]',
        `event = "${eventName}"`,
        `command = "${command.replace(/"/g, '\\"')}"`,
        `timeout = ${eventName === 'Notification' ? BLOCKING_HOOK_TIMEOUT_SECONDS : 5}`,
      ]
      if (eventName === 'PreToolUse' || eventName === 'PostToolUse' || eventName === 'PostToolUseFailure') {
        lines.push('matcher = ".*"')
      }
      return lines.join('\n')
    })

    const nextContents = `${contents.trim() ? `${contents.trim()}\n\n` : ''}${blocks.join('\n\n')}\n`
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, nextContents, 'utf8')
  }

  private uninstallCliHooks(entry: HookRegistryEntry): void {
    const configPath = path.join(this.homeDir, entry.configPath)
    if (!fs.existsSync(configPath)) return

    if (entry.format === 'kimi') {
      const contents = fs.readFileSync(configPath, 'utf8')
      fs.writeFileSync(configPath, `${removeKimiHooks(contents)}\n`, 'utf8')
      return
    }

    const root = readJsonFile(configPath)
    const hooksRoot = typeof root[entry.configKey] === 'object' && root[entry.configKey] !== null
      ? root[entry.configKey] as Record<string, unknown>
      : {}
    const cleaned = removeManagedHookEntries(hooksRoot)
    if (Object.keys(cleaned).length > 0) {
      root[entry.configKey] = cleaned
    } else {
      delete root[entry.configKey]
    }
    writeJsonFile(configPath, root)
  }

  private enableCodexHooksConfig(): void {
    const configPath = path.join(this.homeDir, '.codex', 'config.toml')
    let contents = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : ''
    if (/^\s*codex_hooks\s*=\s*true\s*$/m.test(contents)) return
    if (/^\s*codex_hooks\s*=\s*false\s*$/m.test(contents)) {
      contents = contents.replace(/^\s*codex_hooks\s*=\s*false\s*$/m, 'codex_hooks = true')
    } else if (/^\[features\]\s*$/m.test(contents)) {
      contents = contents.replace(/^\[features\]\s*$/m, '[features]\ncodex_hooks = true')
    } else {
      contents = `${contents.trimEnd()}\n\n[features]\ncodex_hooks = true\n`
    }
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, contents, 'utf8')
  }

  private installOpencodePlugin(): void {
    const opencodeRoot = path.join(this.homeDir, '.config', 'opencode')
    if (!fs.existsSync(opencodeRoot)) return

    const pluginSourcePath = path.join(this.resourcesDir, 'soulidity-opencode-plugin.js')
    copyExecutable(pluginSourcePath, this.managedOpencodePluginPath)

    const pluginUri = `file://${this.managedOpencodePluginPath}`
    const configPaths = [
      path.join(opencodeRoot, 'opencode.json'),
      path.join(opencodeRoot, 'config.json'),
    ]

    const primaryConfig = readJsonFile(configPaths[0])
    const plugins = Array.isArray(primaryConfig.plugin) ? primaryConfig.plugin.filter((item): item is string => typeof item === 'string') : []
    primaryConfig.plugin = [...plugins.filter((item) => !item.includes(OPENCODE_PLUGIN_MARKER)), pluginUri]
    if (!primaryConfig.$schema) {
      primaryConfig.$schema = 'https://opencode.ai/config.json'
    }
    writeJsonFile(configPaths[0], primaryConfig)

    if (fs.existsSync(configPaths[1])) {
      const legacy = readJsonFile(configPaths[1])
      const legacyPlugins = Array.isArray(legacy.plugin) ? legacy.plugin.filter((item): item is string => typeof item === 'string') : []
      const nextLegacy = legacyPlugins.filter((item) => !item.includes(OPENCODE_PLUGIN_MARKER))
      if (nextLegacy.length !== legacyPlugins.length) {
        if (nextLegacy.length > 0) {
          legacy.plugin = nextLegacy
        } else {
          delete legacy.plugin
        }
        writeJsonFile(configPaths[1], legacy)
      }
    }
  }

  private uninstallOpencodePlugin(): void {
    if (fs.existsSync(this.managedOpencodePluginPath)) {
      fs.rmSync(this.managedOpencodePluginPath, { force: true })
    }

    for (const configPath of [
      path.join(this.homeDir, '.config', 'opencode', 'opencode.json'),
      path.join(this.homeDir, '.config', 'opencode', 'config.json'),
    ]) {
      if (!fs.existsSync(configPath)) continue
      const root = readJsonFile(configPath)
      const plugins = Array.isArray(root.plugin) ? root.plugin.filter((item): item is string => typeof item === 'string') : []
      const nextPlugins = plugins.filter((item) => !item.includes(OPENCODE_PLUGIN_MARKER))
      if (nextPlugins.length === plugins.length) continue
      if (nextPlugins.length > 0) root.plugin = nextPlugins
      else delete root.plugin
      writeJsonFile(configPath, root)
    }
  }

  private isOpenCodeInstalled(): boolean {
    if (!fs.existsSync(this.managedOpencodePluginPath)) return false
    const pluginContents = fs.readFileSync(this.managedOpencodePluginPath, 'utf8')
    if (!pluginContents.includes(`// version: ${OPENCODE_PLUGIN_VERSION}`)) return false

    for (const configPath of [
      path.join(this.homeDir, '.config', 'opencode', 'opencode.json'),
      path.join(this.homeDir, '.config', 'opencode', 'config.json'),
    ]) {
      if (!fs.existsSync(configPath)) continue
      const root = readJsonFile(configPath)
      const plugins = Array.isArray(root.plugin) ? root.plugin.filter((item): item is string => typeof item === 'string') : []
      if (plugins.some((item) => item.includes(OPENCODE_PLUGIN_MARKER))) {
        return true
      }
    }
    return false
  }
}

export function getDefaultRuntimeSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\soulidity-runtime'
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : process.pid
  return path.join('/tmp', `soulidity-${uid}.sock`)
}

export function getRuntimeHookStatuses(options: { homeDir?: string } = {}): HookInstallStatus[] {
  return new AgentRuntimeHookManager({
    homeDir: options.homeDir,
    resourcesDir: '',
  }).getStatuses()
}
