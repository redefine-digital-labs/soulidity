/**
 * TaskExecutor — spawn Claude Code / Codex CLI processes and stream output via IPC.
 *
 * Inspired by Confirmo's execute-claude-task pattern:
 * - spawn `claude -p "..." --output-format stream-json`
 * - parse stdout line by line as JSON
 * - push text chunks to renderer via webContents.send
 */

import { spawn, type ChildProcess } from 'node:child_process'
import * as path from 'node:path'
import { BrowserWindow } from 'electron'
import type { PetAgentEvent, PetTaskSummary } from '@soulidity/shared'

let taskCounter = 0
const activeProcesses = new Map<string, ChildProcess>()
const activeTaskMeta = new Map<string, {
  agent: TaskAgent
  instruction: string
  cwd: string
}>()

export type TaskAgent = 'claude' | 'codex'

export interface TaskPayload {
  agent: TaskAgent
  instruction: string
  filePaths?: string[]
  cwd?: string
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

function truncateInstruction(instruction: string): string {
  const singleLine = instruction.replace(/\s+/g, ' ').trim()
  return singleLine.length > 72 ? `${singleLine.slice(0, 69)}...` : singleLine
}

function toPetTaskSummary(taskId: string): PetTaskSummary | undefined {
  const meta = activeTaskMeta.get(taskId)
  if (!meta) return undefined

  return {
    agent: meta.agent,
    sessionId: taskId,
    sessionTitle: truncateInstruction(meta.instruction),
    currentAction: `Running ${meta.agent}`,
    workingDirectory: meta.cwd,
    timestamp: Date.now(),
  }
}

function broadcastAgentEvent(event: PetAgentEvent): void {
  broadcastToWindows('agent-event', event)
}

function resolveCliCommand(agent: TaskAgent, prompt: string): { cmd: string; args: string[] } {
  switch (agent) {
    case 'claude':
      return {
        cmd: 'claude',
        args: [
          '-p', prompt,
          '--output-format', 'stream-json',
          '--allowedTools', 'Bash,Read,Write,Edit',
          '--dangerously-skip-permissions',
        ],
      }
    case 'codex':
      return {
        cmd: 'codex',
        args: ['exec', '--full-auto', prompt],
      }
  }
}

export function executeTask(payload: TaskPayload): TaskStartResult {
  const taskId = `task-${++taskCounter}-${Date.now()}`
  const { agent, instruction, filePaths, cwd } = payload

  // Build prompt
  let prompt = instruction
  if (filePaths && filePaths.length > 0) {
    const fileList = filePaths.map((f) => `- ${f}`).join('\n')
    prompt = `The user has provided these files:\n${fileList}\n\nUser instruction: ${instruction}`
  }

  const cli = resolveCliCommand(agent, prompt)
  const args = cli.args
  const spawnCwd =
    cwd || (filePaths?.[0] ? path.dirname(filePaths[0]) : process.env['HOME'])

  try {
    const child = spawn(cli.cmd, args, {
      cwd: spawnCwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Windows npm-installed CLIs use .cmd shims that require a shell
      shell: process.platform === 'win32',
    })

    activeProcesses.set(taskId, child)
    activeTaskMeta.set(taskId, {
      agent,
      instruction,
      cwd: spawnCwd ?? process.cwd(),
    })
    broadcastAgentEvent({
      type: 'agent-active',
      task: toPetTaskSummary(taskId),
    })

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
      const taskSummary = toPetTaskSummary(taskId)
      activeProcesses.delete(taskId)
      activeTaskMeta.delete(taskId)
      broadcastToWindows('task:complete', {
        taskId,
        success: code === 0,
        error: code !== 0 ? `Process exited with code ${code}` : undefined,
      })
      broadcastAgentEvent({
        type: code === 0 ? 'task-complete' : 'task-error',
        task: taskSummary,
        message: code === 0 ? 'Task completed.' : `Process exited with code ${code}`,
        timestamp: Date.now(),
      })
    })

    child.on('error', (err) => {
      const taskSummary = toPetTaskSummary(taskId)
      activeProcesses.delete(taskId)
      activeTaskMeta.delete(taskId)
      broadcastToWindows('task:complete', {
        taskId,
        success: false,
        error: err.message,
      })
      broadcastAgentEvent({
        type: 'task-error',
        task: taskSummary,
        message: err.message,
        timestamp: Date.now(),
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
  activeTaskMeta.delete(taskId)
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
    activeTaskMeta.delete(taskId)
  }
}
