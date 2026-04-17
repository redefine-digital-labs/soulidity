import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type AgentRuntimeSnapshot,
  CLI_TERMINAL_GRACE_MS,
  MOOD_TO_SPRITE,
  getVisiblePetTasks,
  type AgentStatusFile,
  type Mood,
  type PetAgentEvent,
  type PetTaskSummary,
  type PetUpdateStatus,
} from '@soulidity/shared'
import { useMood } from '../../hooks/useMood'
import './styles.css'
import { SpriteRenderer } from '../SpriteRenderer'
import { useActivePersona } from '../../hooks/useActivePersona'
import { useAgentRuntime } from '../../hooks/useAgentRuntime'

type TaskAgent = 'claude' | 'codex'
type ToastKind = 'info' | 'success' | 'error' | 'attention'

interface ToastState {
  id: number
  kind: ToastKind
  text: string
}

interface TaskPanelState {
  phase: 'compose' | 'output'
  files: string[]
  agent: TaskAgent
  instruction: string
  output: string
  running: boolean
  taskId?: string
  error?: string
}

interface FileWithPath extends File {
  path?: string
}

const WINDOW_PADDING = 28
const BASE_WINDOW_WIDTH = 280
const EXPANDED_WINDOW_WIDTH = 420
const BASE_WINDOW_HEIGHT = 260
const EXPANDED_WINDOW_HEIGHT = 600

const DEFAULT_UPDATE_STATUS: PetUpdateStatus = { state: 'idle' }

function basename(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath
}

function dirname(filePath: string): string {
  return filePath.replace(/[/\\][^/\\]+$/, '')
}

function summarizePath(filePath?: string): string | undefined {
  if (!filePath) return undefined
  const parts = filePath.split(/[/\\]/).filter(Boolean)
  if (parts.length <= 2) return filePath
  return `.../${parts.slice(-2).join('/')}`
}

function truncate(text: string, max = 72): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized
}

function formatAgentLabel(agent: string): string {
  if (agent === 'codex') return 'Codex'
  if (agent === 'claude') return 'Claude'
  if (agent === 'claude-code') return 'Claude Code'
  if (agent === 'opencode') return 'OpenCode'
  return agent
}

function buildFallbackTask(files: string[], agent: TaskAgent, instruction: string, taskId: string): PetTaskSummary {
  return {
    agent,
    taskId,
    sessionId: taskId,
    sessionTitle: truncate(instruction || `Work on ${basename(files[0] ?? taskId)}`),
    currentAction: `Running ${formatAgentLabel(agent)}`,
    workingDirectory: files[0] ? dirname(files[0]) : undefined,
    timestamp: Date.now(),
  }
}

function buildTaskIdentity(task: Pick<PetTaskSummary, 'taskId' | 'sessionId'>): string | null {
  if (task.taskId) return `task:${task.taskId}`
  if (task.sessionId) return `session:${task.sessionId}`
  return null
}

function mergeActiveTasks(runtimeTasks: PetTaskSummary[], fallbackTasks: PetTaskSummary[]): PetTaskSummary[] {
  const seen = new Set<string>()
  const merged: PetTaskSummary[] = []

  for (const task of runtimeTasks) {
    const identity = buildTaskIdentity(task)
    if (identity) seen.add(identity)
    merged.push(task)
  }

  for (const task of fallbackTasks) {
    const identity = buildTaskIdentity(task)
    if (identity && seen.has(identity)) continue
    if (identity) seen.add(identity)
    merged.push(task)
  }

  return merged.sort((left, right) => right.timestamp - left.timestamp)
}

function extractFilePaths(dataTransfer: DataTransfer): string[] {
  return Array.from(dataTransfer.files)
    .map((file) => (file as FileWithPath).path)
    .filter((filePath): filePath is string => Boolean(filePath))
}

export function FloatingBall(): React.JSX.Element {
  const { mood: backendMood } = useMood()
  const { config: spriteConfig } = useActivePersona()
  const { snapshot: runtimeSnapshot } = useAgentRuntime()

  const [statusFile, setStatusFile] = useState<AgentStatusFile | AgentRuntimeSnapshot | null>(null)
  const [updateStatus, setUpdateStatus] = useState<PetUpdateStatus>(DEFAULT_UPDATE_STATUS)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [transientMood, setTransientMood] = useState<Mood | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragDelta, setDragDelta] = useState({ x: 0, y: 0 })
  const [isHovered, setIsHovered] = useState(false)
  const [isDropTargetActive, setIsDropTargetActive] = useState(false)
  const [taskPanel, setTaskPanel] = useState<TaskPanelState | null>(null)
  const [localTasks, setLocalTasks] = useState<Record<string, PetTaskSummary>>({})

  const ballRef = useRef<HTMLDivElement>(null)
  const toastIdRef = useRef(0)
  const dragEnterDepthRef = useRef(0)
  const listenersRef = useRef<{ onMove: (e: MouseEvent) => void; onUp: (e: MouseEvent) => void } | null>(null)
  const transientTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clickCountRef = useRef(0)
  const lastClickTimeRef = useRef(0)
  const lastActivityRef = useRef(Date.now())
  const lastDragPosRef = useRef({ x: 0, y: 0 })
  const movedRef = useRef(false)
  const petCountRef = useRef(0)
  const isPettingRef = useRef(false)
  const instructionRef = useRef<HTMLTextAreaElement | null>(null)

  const showToast = useCallback((kind: ToastKind, text: string) => {
    toastIdRef.current += 1
    setToast({ id: toastIdRef.current, kind, text })
  }, [])

  const setMoodFor = useCallback((nextMood: Mood, durationMs: number) => {
    setTransientMood(nextMood)
    if (transientTimerRef.current) clearTimeout(transientTimerRef.current)
    if (durationMs > 0) {
      transientTimerRef.current = setTimeout(() => setTransientMood(null), durationMs)
    }
  }, [])

  const statusTasks = useMemo(
    () => getVisiblePetTasks(statusFile, {
      now: Date.now(),
      terminalGraceMs: CLI_TERMINAL_GRACE_MS,
    }),
    [statusFile],
  )

  const fallbackTasks = useMemo(
    () => Object.values(localTasks).sort((a, b) => b.timestamp - a.timestamp),
    [localTasks],
  )

  const activeTasks = useMemo(
    () => mergeActiveTasks(statusTasks, fallbackTasks),
    [fallbackTasks, statusTasks],
  )
  const showTaskTooltip = isHovered && activeTasks.length > 0 && !taskPanel
  const topPermission = runtimeSnapshot?.pendingPermissions[0] ?? null
  const topQuestion = runtimeSnapshot?.pendingQuestions[0] ?? null
  const topAttention = topPermission ?? topQuestion
  const showAttentionBubble = Boolean(topAttention) && !taskPanel
  const showUpdateBubble = updateStatus.state === 'available'
    || updateStatus.state === 'downloading'
    || updateStatus.state === 'downloaded'
  const effectiveMood: Mood = isDragging
    ? 'dragging'
    : transientMood ?? (activeTasks.length > 0 ? 'working' : backendMood)

  useEffect(() => {
    return () => {
      if (listenersRef.current) {
        window.removeEventListener('mousemove', listenersRef.current.onMove)
        window.removeEventListener('mouseup', listenersRef.current.onUp)
      }
      if (transientTimerRef.current) clearTimeout(transientTimerRef.current)
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => {
      setToast((current) => current?.id === toast.id ? null : current)
    }, 3200)
  }, [toast])

  useEffect(() => {
    if (taskPanel?.phase === 'compose') {
      instructionRef.current?.focus()
    }
  }, [taskPanel?.phase])

  useEffect(() => {
    if (runtimeSnapshot) {
      setStatusFile(runtimeSnapshot)
    }
  }, [runtimeSnapshot])

  useEffect(() => {
    let disposed = false

    window.electronAPI.getCurrentAgentStatus()
      .then((file) => {
        if (!disposed) setStatusFile((file as AgentStatusFile | null) ?? null)
      })
      .catch(() => {})

    window.electronAPI.getUpdateStatus()
      .then((status) => {
        if (!disposed) setUpdateStatus(status)
      })
      .catch(() => {})

    const unsubscribeStatus = window.electronAPI.onAgentStatusChanged((file) => {
      setStatusFile((file as AgentStatusFile | null) ?? null)
    })

    const unsubscribeAgentEvent = window.electronAPI.onAgentEvent((event: PetAgentEvent) => {
      if (event.type === 'needs-attention') {
        setMoodFor('surprised', 3200)
        showToast('attention', event.message || '需要你的处理')
      }
    })

    const unsubscribeUpdate = window.electronAPI.onUpdateStatus((status) => {
      setUpdateStatus(status)
      if (status.state === 'available') {
        showToast('info', `发现新版本 ${status.version ?? ''}`.trim())
        setMoodFor('surprised', 2200)
      } else if (status.state === 'downloaded') {
        showToast('success', `更新 ${status.version ?? ''} 已下载，可立即安装`.trim())
      } else if (status.state === 'error' && status.error) {
        showToast('error', `更新失败：${status.error}`)
      }
    })

    const unsubscribeOutput = window.electronAPI.onTaskOutput(({ taskId, text }) => {
      setTaskPanel((current) => {
        if (!current || current.taskId !== taskId) return current
        return { ...current, output: `${current.output}${text}` }
      })
    })

    const unsubscribeComplete = window.electronAPI.onTaskComplete(({ taskId, success, error }) => {
      setLocalTasks((current) => {
        const next = { ...current }
        delete next[taskId]
        return next
      })
      setTaskPanel((current) => {
        if (!current || current.taskId !== taskId) return current
        return {
          ...current,
          running: false,
          error: success ? undefined : error,
        }
      })

      if (success) {
        setMoodFor('celebrate', 3600)
        showToast('success', '任务已完成')
      } else {
        setMoodFor('angry', 3600)
        showToast('error', error || '任务执行失败')
      }
    })

    return () => {
      disposed = true
      unsubscribeStatus?.()
      unsubscribeAgentEvent?.()
      unsubscribeUpdate?.()
      unsubscribeOutput?.()
      unsubscribeComplete?.()
    }
  }, [setMoodFor, showToast])

  useEffect(() => {
    if (taskPanel) {
      window.electronAPI.setIgnoreMouseEvents(false)
    } else if (!isHovered && !isDragging && !isDropTargetActive) {
      window.electronAPI.setIgnoreMouseEvents(true)
    }
  }, [isDropTargetActive, isDragging, isHovered, taskPanel])

  useEffect(() => {
    const overlayHeight = taskPanel
      ? EXPANDED_WINDOW_HEIGHT
      : Math.min(
        380,
        BASE_WINDOW_HEIGHT
          + (toast ? 60 : 0)
          + (showAttentionBubble ? 88 : 0)
          + (isHovered && activeTasks.length > 0 ? Math.min(120, activeTasks.length * 52) : 0)
          + (showUpdateBubble ? 48 : 0),
      )

    window.electronAPI.resizePetWindow(
      taskPanel ? EXPANDED_WINDOW_WIDTH : BASE_WINDOW_WIDTH,
      overlayHeight + WINDOW_PADDING * 2,
    )
  }, [activeTasks.length, isHovered, showAttentionBubble, showUpdateBubble, taskPanel, toast])

  const handleOpenAgentTab = useCallback(async () => {
    await window.electronAPI.openMainWindowTab('agent')
  }, [])

  const handleQuickApprove = useCallback(async () => {
    if (!topPermission) return
    await window.electronAPI.approveAgentPermission(topPermission.requestId)
  }, [topPermission])

  const handleQuickDeny = useCallback(async () => {
    if (!topPermission) return
    await window.electronAPI.denyAgentPermission(topPermission.requestId)
  }, [topPermission])

  useEffect(() => {
    if (taskPanel || transientMood || isDragging) return

    const randomTimer = setInterval(() => {
      const rand = Math.random()
      if (rand < 0.1) setMoodFor('sleepy', 9000)
      else if (rand < 0.15) setMoodFor('happy', 1800)
    }, 10_000)

    const snoringTimer = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= 60_000) {
        setMoodFor('snoring', 25_000)
      }
    }, 5000)

    return () => {
      clearInterval(randomTimer)
      clearInterval(snoringTimer)
    }
  }, [isDragging, setMoodFor, taskPanel, transientMood])

  const dragStyle: React.CSSProperties | undefined = isDragging
    ? {
      transform: `rotate(${Math.max(-25, Math.min(25, -dragDelta.x * 2))}deg) scaleX(${1 - Math.abs(dragDelta.x) * 0.005}) scaleY(${1 + Math.abs(dragDelta.y) * 0.01})`,
      transition: 'transform 0.05s ease-out',
      animation: 'none',
    }
    : undefined

  const handleRootMouseEnter = useCallback(() => {
    setIsHovered(true)
    window.electronAPI.setIgnoreMouseEvents(false)
  }, [])

  const handleRootMouseLeave = useCallback(() => {
    setIsHovered(false)
    if (!isDragging && !taskPanel && !isDropTargetActive) {
      window.electronAPI.setIgnoreMouseEvents(true)
    }
    if (isPettingRef.current) {
      isPettingRef.current = false
      petCountRef.current = 0
    }
  }, [isDragging, isDropTargetActive, taskPanel])

  const handleBallMouseMove = useCallback(() => {
    if (isDragging) return
    lastActivityRef.current = Date.now()
    if (!isPettingRef.current) isPettingRef.current = true
    petCountRef.current += 1

    if (petCountRef.current > 5 && petCountRef.current < 15) {
      setMoodFor('happy', 2500)
    } else if (petCountRef.current >= 15) {
      setMoodFor('love', 2800)
    }
  }, [isDragging, setMoodFor])

  const handleSingleClick = useCallback(() => {
    lastActivityRef.current = Date.now()
    const now = Date.now()
    clickCountRef.current = (now - lastClickTimeRef.current < 400) ? clickCountRef.current + 1 : 1
    lastClickTimeRef.current = now

    if (clickCountRef.current >= 5) {
      setMoodFor('angry', 2000)
      clickCountRef.current = 0
    } else if (clickCountRef.current >= 2) {
      setMoodFor('surprised', 500)
      setTimeout(() => setMoodFor('excited', 1800), 500)
    } else {
      setMoodFor('happy', 1800)
    }

    window.electronAPI.moodInteract().catch(() => {})
  }, [setMoodFor])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    lastActivityRef.current = Date.now()
    movedRef.current = false
    lastDragPosRef.current = { x: e.screenX, y: e.screenY }
    window.electronAPI.dragStart()

    longPressTimerRef.current = setTimeout(() => {
      if (!movedRef.current) setMoodFor('shy', 2500)
    }, 800)

    const onMove = (event: MouseEvent): void => {
      if (longPressTimerRef.current && !movedRef.current) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }

      if (!movedRef.current) {
        movedRef.current = true
        setIsDragging(true)
        window.electronAPI.moodDragStart().catch(() => {})
      }

      const frameDx = event.screenX - lastDragPosRef.current.x
      const frameDy = event.screenY - lastDragPosRef.current.y
      lastDragPosRef.current = { x: event.screenX, y: event.screenY }
      setDragDelta((current) => ({
        x: current.x * 0.7 + frameDx * 0.3,
        y: current.y * 0.7 + frameDy * 0.3,
      }))

      window.electronAPI.dragMove()
    }

    const onUp = (event: MouseEvent): void => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }

      window.electronAPI.dragEnd()

      if (movedRef.current) {
        setIsDragging(false)
        setDragDelta({ x: 0, y: 0 })
        window.electronAPI.moodDragEnd().catch(() => {})
      }

      const rect = ballRef.current?.getBoundingClientRect()
      if (rect) {
        const isOverBall = event.clientX >= rect.left && event.clientX <= rect.right
          && event.clientY >= rect.top && event.clientY <= rect.bottom
        if (!isOverBall && !taskPanel && !isDropTargetActive) {
          window.electronAPI.setIgnoreMouseEvents(true)
        }
      }

      if (!movedRef.current) {
        if (clickTimerRef.current) {
          clearTimeout(clickTimerRef.current)
          clickTimerRef.current = null
        } else {
          clickTimerRef.current = setTimeout(() => {
            clickTimerRef.current = null
            handleSingleClick()
          }, 250)
        }
      }

      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      listenersRef.current = null
    }

    listenersRef.current = { onMove, onUp }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [handleSingleClick, isDropTargetActive, setMoodFor, taskPanel])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    window.electronAPI.showContextMenu()
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragEnterDepthRef.current += 1
    setIsDropTargetActive(true)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!isDropTargetActive) setIsDropTargetActive(true)
  }, [isDropTargetActive])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragEnterDepthRef.current = Math.max(0, dragEnterDepthRef.current - 1)
    if (dragEnterDepthRef.current === 0) {
      setIsDropTargetActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragEnterDepthRef.current = 0
    setIsDropTargetActive(false)

    if (taskPanel?.running) {
      showToast('attention', '当前任务仍在运行，请先取消或等待完成。')
      return
    }

    const filePaths = extractFilePaths(e.dataTransfer)
    if (filePaths.length === 0) {
      showToast('error', '没有读取到可执行的本地文件路径。')
      return
    }

    setTaskPanel({
      phase: 'compose',
      files: filePaths,
      agent: taskPanel?.agent ?? 'codex',
      instruction: taskPanel?.phase === 'compose' ? taskPanel.instruction : '',
      output: '',
      running: false,
    })
    setMoodFor('surprised', 1200)
  }, [setMoodFor, showToast, taskPanel])

  const handleInstructionChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setTaskPanel((current) => current ? { ...current, instruction: value } : current)
  }, [])

  const handleAgentChange = useCallback((agent: TaskAgent) => {
    setTaskPanel((current) => current ? { ...current, agent } : current)
  }, [])

  const handleClosePanel = useCallback(() => {
    if (taskPanel?.running) return
    setTaskPanel(null)
  }, [taskPanel?.running])

  const handleCancelTask = useCallback(() => {
    if (!taskPanel?.taskId || !taskPanel.running) return
    window.electronAPI.cancelTask(taskPanel.taskId)
    showToast('info', '正在取消任务...')
  }, [showToast, taskPanel])

  const handleSubmitTask = useCallback(async () => {
    if (!taskPanel) return
    const instruction = taskPanel.instruction.trim()
    if (!instruction) {
      showToast('attention', '先写清楚你要它处理什么。')
      return
    }

    const result = await window.electronAPI.executeTask({
      agent: taskPanel.agent,
      instruction,
      filePaths: taskPanel.files,
    })

    if (result.error) {
      showToast('error', result.error)
      setTaskPanel((current) => current ? { ...current, error: result.error } : current)
      return
    }

    const taskId = result.taskId
    const fallbackTask = buildFallbackTask(taskPanel.files, taskPanel.agent, instruction, taskId)
    setLocalTasks((current) => ({ ...current, [taskId]: fallbackTask }))
    setTaskPanel((current) => current ? {
      ...current,
      phase: 'output',
      output: '',
      running: true,
      taskId,
      error: undefined,
    } : current)
    setMoodFor('working', 1400)
  }, [setMoodFor, showToast, taskPanel])

  const handleUpdateBubbleClick = useCallback(async () => {
    if (updateStatus.state === 'available') {
      const result = await window.electronAPI.updaterDownload()
      if (!result.ok && result.error) {
        showToast('error', result.error)
      }
      return
    }

    if (updateStatus.state === 'downloaded') {
      await window.electronAPI.updaterInstall()
    }
  }, [showToast, updateStatus.state])

  const updateBubbleLabel = updateStatus.state === 'available'
    ? `发现更新 ${updateStatus.version ?? ''}`.trim()
    : updateStatus.state === 'downloading'
      ? `下载中 ${Math.round(updateStatus.progress ?? 0)}%`
      : `安装 ${updateStatus.version ?? ''}`.trim()

  return (
    <div
      className={`ball-root${taskPanel ? ' ball-root--expanded' : ''}`}
      onMouseEnter={handleRootMouseEnter}
      onMouseLeave={handleRootMouseLeave}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="pet-overlay-stack">
        {showUpdateBubble && (
          <button
            className={`update-bubble${updateStatus.state === 'downloaded' ? ' update-bubble--ready' : ''}`}
            disabled={updateStatus.state === 'downloading'}
            onClick={handleUpdateBubbleClick}
            title={updateStatus.state === 'downloaded' ? 'Install update' : 'Download update'}
          >
            {updateBubbleLabel}
          </button>
        )}

        {toast && (
          <div className={`pet-toast pet-toast--${toast.kind}`}>
            {toast.text}
          </div>
        )}

        {showAttentionBubble && topAttention && (
          <div className="attention-bubble">
            <div className="attention-bubble__title">
              {topPermission ? 'Permission Request' : 'Question Waiting'}
            </div>
            <div className="attention-bubble__text">
              {topPermission
                ? `${formatAgentLabel(topPermission.source)} wants ${topPermission.toolName}`
                : topQuestion?.question}
            </div>
            <div className="attention-bubble__actions">
              {topPermission && (
                <>
                  <button type="button" className="attention-bubble__button" onClick={() => { void handleQuickApprove() }}>
                    Allow
                  </button>
                  <button type="button" className="attention-bubble__button attention-bubble__button--secondary" onClick={() => { void handleQuickDeny() }}>
                    Deny
                  </button>
                </>
              )}
              <button type="button" className="attention-bubble__button attention-bubble__button--secondary" onClick={() => { void handleOpenAgentTab() }}>
                Open Agent
              </button>
            </div>
          </div>
        )}

        {showTaskTooltip && (
          <div className="task-tooltip">
            <div className="task-tooltip__title">当前任务</div>
            <div className="task-tooltip__list">
              {activeTasks.map((task) => (
                <div key={task.sessionId ?? `${task.agent}-${task.timestamp}`} className="task-tooltip__item">
                  <div className="task-tooltip__head">
                    <span>{formatAgentLabel(task.agent)}</span>
                    {task.sessionTitle && <span>{task.sessionTitle}</span>}
                  </div>
                  {task.currentAction && <div className="task-tooltip__meta">{task.currentAction}</div>}
                  {task.workingDirectory && (
                    <div className="task-tooltip__meta">{summarizePath(task.workingDirectory)}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {taskPanel && (
          <div className="task-panel">
            <div className="task-panel__header">
              <div>
                <div className="task-panel__title">
                  {taskPanel.phase === 'compose' ? '投递任务' : taskPanel.running ? '任务执行中' : '任务输出'}
                </div>
                <div className="task-panel__subtitle">
                  {taskPanel.files.length} 个文件
                </div>
              </div>
              <button
                className="task-panel__ghost"
                onClick={taskPanel.running ? handleCancelTask : handleClosePanel}
              >
                {taskPanel.running ? 'Cancel' : 'Close'}
              </button>
            </div>

            <div className="task-panel__files">
              {taskPanel.files.map((filePath) => (
                <span key={filePath} className="task-panel__file-chip">{basename(filePath)}</span>
              ))}
            </div>

            {taskPanel.phase === 'compose' && (
              <>
                <div className="task-panel__agents">
                  {(['codex', 'claude'] as TaskAgent[]).map((agent) => (
                    <button
                      key={agent}
                      className={`task-panel__agent ${taskPanel.agent === agent ? 'task-panel__agent--active' : ''}`}
                      onClick={() => handleAgentChange(agent)}
                    >
                      {formatAgentLabel(agent)}
                    </button>
                  ))}
                </div>

                <textarea
                  ref={instructionRef}
                  className="task-panel__textarea"
                  placeholder="告诉它要做什么，例如：比较这些文件里的交互差异并给出修复方案。"
                  value={taskPanel.instruction}
                  onChange={handleInstructionChange}
                />

                {taskPanel.error && (
                  <div className="task-panel__error">{taskPanel.error}</div>
                )}

                <div className="task-panel__actions">
                  <button className="task-panel__primary" onClick={handleSubmitTask}>
                    开始执行
                  </button>
                </div>
              </>
            )}

            {taskPanel.phase === 'output' && (
              <>
                <div className="task-panel__status">
                  {taskPanel.running
                    ? `${formatAgentLabel(taskPanel.agent)} 正在处理`
                    : taskPanel.error
                      ? `执行失败：${taskPanel.error}`
                      : '执行完成'}
                </div>
                <pre className="task-panel__output">
                  {taskPanel.output || '等待输出...'}
                </pre>
              </>
            )}
          </div>
        )}
      </div>

      {isDropTargetActive && (
        <div className="drop-overlay">
          <div className="drop-overlay__card">
            <div className="drop-overlay__title">把文件丢给宠物</div>
            <div className="drop-overlay__subtitle">释放后会进入任务说明面板</div>
          </div>
        </div>
      )}

      <div className="bottom-section">
        <div
          ref={ballRef}
          className="ball"
          data-mood={effectiveMood}
          style={dragStyle}
          onMouseDown={handleMouseDown}
          onMouseMove={handleBallMouseMove}
          onContextMenu={handleContextMenu}
          title="Claw"
        >
          <SpriteRenderer
            config={spriteConfig}
            animation={MOOD_TO_SPRITE[effectiveMood]}
            width={120}
            height={120}
            idlePause
          />
        </div>
      </div>
    </div>
  )
}
