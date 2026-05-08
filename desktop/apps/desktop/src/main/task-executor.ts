/**
 * TaskExecutor — spawn Claude Code / Codex CLI processes and stream output via IPC.
 *
 * Inspired by Confirmo's execute-claude-task pattern:
 * - spawn `claude -p "..." --output-format stream-json --verbose`
 * - parse stdout line by line as JSON
 * - push text chunks to renderer via webContents.send
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import * as path from 'node:path'
import { BrowserWindow } from 'electron'
import type { TaskExecutionMode } from '@soulidity/shared'

let taskCounter = 0
const activeProcesses = new Map<string, ChildProcess>()

export type TaskAgent = 'claude' | 'codex'

export function isTaskAgent(value: unknown): value is TaskAgent {
  return value === 'claude' || value === 'codex'
}

// Caps the instruction length that can be bound into an approval token. The
// native approval dialog and the renderer approval panel must display the
// exact instruction that will be replayed at execution time — if the text is
// so long that either surface silently truncates it, the user is no longer
// guaranteed to see the tail of what they are authorizing (a compromised
// renderer could craft a benign-looking preamble with a destructive suffix).
// 4000 chars comfortably fits every realistic task instruction and every
// platform's dialog `detail` rendering; we fail closed on anything larger.
export const MAX_APPROVED_INSTRUCTION_LENGTH = 4000

// Main-process one-shot write-approval tokens. The renderer cannot mint these;
// they are only created after a main-process confirmation flow. `executeTask`
// rejects `executionMode: 'write'` without a valid token and also verifies
// that the caller's agent, instruction, and file list match what the user
// actually approved — the renderer cannot swap any of them after the fact.
interface WriteApprovalRecord {
  filePaths: string[] // normalized (absolute + sorted + deduped)
  agent: TaskAgent
  instruction: string
  expiresAt: number
}
const writeApprovals = new Map<string, WriteApprovalRecord>()
const WRITE_APPROVAL_TTL_MS = 60_000

function purgeExpiredApprovals(now = Date.now()): void {
  for (const [token, record] of writeApprovals) {
    if (record.expiresAt <= now) writeApprovals.delete(token)
  }
}

function normalizeFilePaths(filePaths: string[]): string[] {
  const deduped = new Set<string>()
  for (const p of filePaths) {
    if (typeof p === 'string' && p.length > 0) {
      deduped.add(path.resolve(p))
    }
  }
  return Array.from(deduped).sort()
}

// The instruction shown in the approval dialog and the one replayed at
// execution time must compare equal even when the renderer trims trailing
// whitespace (textareas routinely carry a trailing newline). Canonicalize
// both sides via `.trim()` so a stray newline can no longer invalidate a
// token the user just approved.
function canonicalizeInstruction(raw: string): string {
  return raw.trim()
}

// Well-known shallow/system roots that should never be used as the Codex
// `workspace-write` sandbox cwd. If the narrowest common ancestor of the
// approved files lands on one of these, the approval would widen Codex's
// write surface far beyond the files the user actually saw and confirmed.
// We fail closed instead of silently letting the write scope escalate.
const DANGEROUS_SANDBOX_ROOTS = new Set<string>([
  '/',
  '/Users',
  '/home',
  '/tmp',
  '/private',
  '/private/tmp',
  '/private/var',
  '/var',
  '/opt',
  '/usr',
  '/bin',
  '/sbin',
  '/etc',
  '/root',
  '/System',
  '/Library',
  '/Applications',
  '/Volumes',
])

export function isSafeSandboxRoot(root: string | undefined): boolean {
  if (!root) return false
  // Windows drive root like 'C:\', 'C:/', or bare 'C:' — check the raw input
  // first because `path.resolve` on a POSIX host will re-interpret it as a
  // relative path and hide the issue in cross-platform tests.
  if (/^[A-Za-z]:[\\/]?$/.test(root)) return false
  const resolved = path.resolve(root)
  if (DANGEROUS_SANDBOX_ROOTS.has(resolved)) return false
  if (/^[A-Za-z]:[\\/]?$/.test(resolved)) return false
  // Require at least two meaningful path segments (ignoring any drive
  // letter) so we never hand Codex a scope as wide as `/Users` or `C:\Users`.
  const segments = resolved
    .split(/[/\\]+/)
    .filter((s) => s.length > 0 && !/^[A-Za-z]:$/.test(s))
  return segments.length >= 2
}

export interface CreateWriteApprovalInput {
  filePaths: string[]
  agent: TaskAgent
  instruction: string
}

export function createWriteApprovalToken(input: CreateWriteApprovalInput): string | null {
  purgeExpiredApprovals()
  const normalized = normalizeFilePaths(input.filePaths)
  if (normalized.length === 0) return null
  if (!isSafeSandboxRoot(resolveApprovedSandboxRoot(normalized))) return null
  const canonicalInstruction = canonicalizeInstruction(input.instruction)
  // Fail closed rather than minting a token whose bound instruction may be
  // silently truncated by a confirmation surface. Callers must surface the
  // rejection to the user and ask them to shorten the prompt.
  if (canonicalInstruction.length > MAX_APPROVED_INSTRUCTION_LENGTH) return null
  const token = randomBytes(32).toString('hex')
  writeApprovals.set(token, {
    filePaths: normalized,
    agent: input.agent,
    instruction: canonicalInstruction,
    expiresAt: Date.now() + WRITE_APPROVAL_TTL_MS,
  })
  return token
}

function consumeWriteApprovalToken(token: string): WriteApprovalRecord | null {
  purgeExpiredApprovals()
  const record = writeApprovals.get(token)
  if (!record) return null
  writeApprovals.delete(token)
  if (record.expiresAt <= Date.now()) return null
  return record
}

export function __testing_clearWriteApprovals(): void {
  writeApprovals.clear()
}

// Narrowest directory that contains every approved file. For single-dir
// drops this collapses to the shared parent. For multi-dir approvals it
// widens just enough to let the Codex workspace-write sandbox reach every
// approved file, instead of the current "dirname of first file" which both
// misses sibling approvals and breaks multi-directory tasks.
export function resolveApprovedSandboxRoot(filePaths: string[]): string | undefined {
  if (filePaths.length === 0) return undefined
  const dirs = filePaths.map((p) => path.dirname(path.resolve(p)))
  if (dirs.length === 1) return dirs[0]
  const splitDirs = dirs.map((d) => d.split(path.sep))
  const first = splitDirs[0]
  if (!first) return undefined
  const common: string[] = []
  for (let i = 0; i < first.length; i++) {
    const segment = first[i]
    if (splitDirs.every((parts) => parts[i] === segment)) {
      common.push(segment ?? '')
    } else {
      break
    }
  }
  if (common.length === 0) return undefined
  const joined = common.join(path.sep)
  return joined.length === 0 ? path.sep : joined
}

export interface TaskPayload {
  agent: TaskAgent
  instruction: string
  filePaths?: string[]
  cwd?: string
  executionMode?: TaskExecutionMode
  approvalToken?: string
}

export interface TaskStartResult {
  taskId: string
  error?: string
}

function broadcastToWindows(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data)
  }
}

export function buildTaskPrompt(
  instruction: string,
  filePaths: string[] | undefined,
  executionMode: TaskExecutionMode,
): string {
  const executionHeader = executionMode === 'write'
    ? 'You may update files directly when needed, but keep changes scoped to the requested task and the provided files when possible.'
    : 'Read-only task. Do not modify files, write files, or run destructive commands.'
  const trimmedInstruction = instruction.trim()

  if (filePaths && filePaths.length > 0) {
    const fileList = filePaths.map((f) => `- ${f}`).join('\n')
    return `${executionHeader}\n\nThe user has provided these files:\n${fileList}\n\nUser instruction: ${trimmedInstruction}`
  }

  return `${executionHeader}\n\nUser instruction: ${trimmedInstruction}`
}

export function resolveCliCommand(
  agent: TaskAgent,
  prompt: string,
  executionMode: TaskExecutionMode,
): { cmd: string; args: string[] } {
  switch (agent) {
    case 'claude':
      return {
        cmd: 'claude',
        // `--verbose` is mandatory whenever `-p` (`--print`) is combined with
        // `--output-format stream-json`. Claude CLI ≥ 2.1 rejects the spawn
        // outright with `Error: When using --print, --output-format=stream-json
        // requires --verbose`. Keep the flag adjacent to `--output-format` so
        // the binding is obvious to future readers.
        args: executionMode === 'write'
          ? [
            '-p', prompt,
            '--output-format', 'stream-json',
            '--verbose',
            '--allowedTools', 'Bash,Read,Write,Edit',
            '--dangerously-skip-permissions',
          ]
          // Read-only must actually be read-only. `Bash` is omitted here because
          // it can mutate the filesystem via shell redirects (`echo x > f`),
          // `sed -i`, `rm`, etc., which would silently bypass the write-approval
          // gate the UI promises. The remaining tools are strictly read-only.
          : [
            '-p', prompt,
            '--output-format', 'stream-json',
            '--verbose',
            '--allowedTools', 'Read,Grep,Glob',
          ],
      }
    case 'codex':
      // `-a/--ask-for-approval` is a top-level Codex CLI flag that must precede
      // the `exec` subcommand (Codex CLI 0.122.0: `codex exec` rejects `-a`).
      return {
        cmd: 'codex',
        args: [
          '-a',
          'never',
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          executionMode === 'write' ? 'workspace-write' : 'read-only',
          prompt,
        ],
      }
  }
}

export function executeTask(payload: TaskPayload): TaskStartResult {
  const taskId = `task-${++taskCounter}-${Date.now()}`
  // `payload` itself is renderer-controlled. Defend against a null/undefined
  // top-level or non-object value before destructuring, otherwise a malformed
  // `task:execute` call would throw a `Cannot destructure` TypeError up the
  // main-process IPC path instead of returning a structured `{ error }`.
  if (payload === null || typeof payload !== 'object') {
    return { taskId, error: 'Task payload must be an object.' }
  }
  const {
    agent,
    instruction,
    filePaths,
    cwd,
    executionMode = 'read',
    approvalToken,
  } = payload

  // The `task:execute` IPC boundary forwards raw renderer payloads; TypeScript
  // narrowing cannot be trusted here. Unsupported agent values must be
  // rejected with a structured error rather than letting `resolveCliCommand`
  // fall through and throw `Cannot read properties of undefined (reading
  // 'args')` on the main-process path.
  if (!isTaskAgent(agent)) {
    return { taskId, error: `Unsupported task agent: ${String(agent)}` }
  }

  // Every other renderer-supplied field is validated at this boundary too.
  // Downstream helpers (`buildTaskPrompt`, `canonicalizeInstruction`,
  // `path.dirname`, `path.resolve`) dereference these fields before the
  // `try`/`catch` below, so a null `instruction` or a `filePaths` entry that
  // isn't a string would otherwise surface as an unhandled exception on the
  // main-process path — exactly the contract the approval gate is supposed
  // to prevent. Return a structured `{ taskId, error }` for every malformed
  // shape instead.
  if (typeof instruction !== 'string') {
    return { taskId, error: 'Task instruction must be a string.' }
  }
  if (filePaths !== undefined) {
    if (!Array.isArray(filePaths)) {
      return { taskId, error: 'Task filePaths must be an array of strings.' }
    }
    for (const p of filePaths) {
      if (typeof p !== 'string' || p.length === 0) {
        return { taskId, error: 'Task filePaths must contain only non-empty strings.' }
      }
    }
  }
  if (cwd !== undefined && typeof cwd !== 'string') {
    return { taskId, error: 'Task cwd must be a string.' }
  }
  if (approvalToken !== undefined && typeof approvalToken !== 'string') {
    return { taskId, error: 'Task approval token must be a string.' }
  }
  if (executionMode !== 'read' && executionMode !== 'write') {
    return { taskId, error: `Unsupported execution mode: ${String(executionMode)}` }
  }

  // Enforce the write-mode privilege boundary inside the main process. A
  // compromised or malicious renderer can still call `task:execute`, but
  // without a main-process-issued approval token it cannot run write mode,
  // and the token is bound to the exact (agent, instruction, filePaths)
  // the user actually approved — the renderer cannot swap any of them
  // after the fact or widen the write scope by supplying its own cwd.
  let effectiveFilePaths = filePaths
  let effectiveCwd: string | undefined = cwd
  if (executionMode === 'write') {
    if (!approvalToken) {
      return { taskId, error: 'Write mode requires an approval token issued by the main process.' }
    }
    const record = consumeWriteApprovalToken(approvalToken)
    if (!record) {
      return { taskId, error: 'Write approval token is invalid or expired.' }
    }
    if (record.agent !== agent) {
      return { taskId, error: 'Write approval token does not match the requested agent.' }
    }
    if (record.instruction !== canonicalizeInstruction(instruction)) {
      return { taskId, error: 'Write approval token does not match the approved instruction.' }
    }
    const requestedPaths = normalizeFilePaths(filePaths ?? [])
    const approvedPaths = record.filePaths
    const sameScope =
      requestedPaths.length === approvedPaths.length
      && requestedPaths.every((p, i) => p === approvedPaths[i])
    if (!sameScope) {
      return { taskId, error: 'Write approval token does not match the approved file list.' }
    }
    effectiveFilePaths = approvedPaths
    effectiveCwd = resolveApprovedSandboxRoot(approvedPaths)
    // Defense in depth: even if `createWriteApprovalToken` let the token through,
    // refuse to spawn a write-capable child when the resolved sandbox root is
    // too broad. This is the last checkpoint before Codex's workspace-write
    // sandbox inherits our cwd.
    if (!isSafeSandboxRoot(effectiveCwd)) {
      return { taskId, error: 'Approved file list does not share a safe sandbox root.' }
    }
  }

  const prompt = buildTaskPrompt(instruction, effectiveFilePaths, executionMode)
  const cli = resolveCliCommand(agent, prompt, executionMode)
  const args = cli.args
  const spawnCwd =
    effectiveCwd
    || (effectiveFilePaths?.[0] ? path.dirname(effectiveFilePaths[0]) : process.env['HOME'])

  try {
    const child = spawn(cli.cmd, args, {
      cwd: spawnCwd,
      env: { ...process.env, SOULIDITY_TASK_ID: taskId },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Windows npm-installed CLIs use .cmd shims that require a shell
      shell: process.platform === 'win32',
    })

    activeProcesses.set(taskId, child)

    let buffer = ''
    child.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line)
          let text = ''

          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text') {
                text += block.text
              } else if (block.type === 'tool_use') {
                text += `\n[${block.name}]: ${JSON.stringify(block.input).slice(0, 200)}\n`
              }
            }
          } else if (event.type === 'content_block_delta' && event.delta?.text) {
            text = event.delta.text
          } else if (event.type === 'result') {
            text =
              typeof event.result === 'string'
                ? event.result
                : JSON.stringify(event.result, null, 2)
          }

          if (text) {
            broadcastToWindows('task:output', { taskId, text })
          }
        } catch {
          // Non-JSON line, send as-is
          broadcastToWindows('task:output', { taskId, text: line })
        }
      }
    })

    child.stderr?.on('data', (data: Buffer) => {
      broadcastToWindows('task:output', { taskId, text: data.toString() })
    })

    child.on('close', (code) => {
      // Flush remaining buffer
      if (buffer.trim()) {
        broadcastToWindows('task:output', { taskId, text: buffer })
      }
      activeProcesses.delete(taskId)
      broadcastToWindows('task:complete', {
        taskId,
        success: code === 0,
        error: code !== 0 ? `Process exited with code ${code}` : undefined,
      })
    })

    child.on('error', (err) => {
      activeProcesses.delete(taskId)
      broadcastToWindows('task:complete', {
        taskId,
        success: false,
        error: err.message,
      })
    })

    return { taskId }
  } catch (err) {
    return { taskId, error: err instanceof Error ? err.message : String(err) }
  }
}

export function cancelTask(taskId: string): boolean {
  const child = activeProcesses.get(taskId)
  if (!child) return false
  child.kill('SIGTERM')
  activeProcesses.delete(taskId)
  return true
}

export function getActiveTaskIds(): string[] {
  return Array.from(activeProcesses.keys())
}

export function shutdownAllTasks(): void {
  for (const [taskId, child] of activeProcesses) {
    try {
      child.kill('SIGTERM')
    } catch {
      // Process may have already exited
    }
    activeProcesses.delete(taskId)
  }
}
