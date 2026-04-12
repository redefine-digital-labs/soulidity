import type { FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import type { WebSocket } from 'ws'
import type { ChatMessageData } from '@soulidity/shared'
import { TaskCoordinator } from '../task-coordinator'
import { memoryService } from '../memory/memory-service'
import { emotionService } from '../memory/emotion-service'
import { feedInterpretBuffer } from '../memory/interpret-service'
import {
  getRequestToken,
  isAllowedOrigin,
  isAuthorizedToken,
  type BackendAccessConfig
} from '../security/request-auth'

/** 内存会话记录 — setupWebSocket 时从当日 JSON 恢复（须在 initDataDir 之后） */
let conversation: ChatMessageData[] = []
const clients = new Set<WebSocket>()
/** Pending user turns not yet in conversation (taskId → content). Cleared on task success/error/cancel. */
const pendingUserTurns = new Map<string, string>()

/** 任务协调器：FIFO 串行队列 */
const coordinator = new TaskCoordinator(
  // getHistory：返回当前已完成的会话历史（user 消息由 pushMessages 在任务成功后追加）
  () => [...conversation],
  // pushMessages：任务完成后追加本轮所有消息（tool_calls + tool_result + final assistant）
  (messages, userContent) => {
    // 用户消息在任务成功后才追加到会话（非入队时），避免排队任务打乱顺序
    if (userContent) conversation.push({ role: 'user', content: userContent })
    conversation.push(...messages)
    // Persist user message to disk only on success (deferred from enqueue-time)
    if (userContent) memoryService.appendMessage({ role: 'user', content: userContent })
    memoryService.appendMessages(messages)
    // 异步触发摘要压缩检查（不阻塞当前任务完成）
    void memoryService.compressIfNeeded(conversation)
    // 将本轮对话喂入 interpret buffer（补上 user 消息，确保轮次计数正确）
    const interpretMessages: ChatMessageData[] = []
    if (userContent) interpretMessages.push({ role: 'user', content: userContent })
    interpretMessages.push(...messages)
    feedInterpretBuffer(interpretMessages)
  }
)

let msgCounter = 0
function genMsgId(): string {
  return `msg_${Date.now()}_${++msgCounter}`
}

function sendTo(ws: WebSocket, envelope: object): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(envelope))
  }
}

function broadcast(envelope: object): void {
  const data = JSON.stringify(envelope)
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(data)
    }
  }
}

/**
 * 注册 Fastify WebSocket 插件并设置 /ws 路由
 */
export async function setupWebSocket(
  app: FastifyInstance,
  accessConfig: BackendAccessConfig
): Promise<void> {
  // 延迟加载：确保 initDataDir() 已执行，路径正确
  conversation = memoryService.getTodayMessages()

  await app.register(websocket)

  app.get('/ws', { websocket: true }, (socket, request) => {
    const origin = request.headers.origin
    const token = getRequestToken(request.headers.authorization, request.raw.url)
    const originAllowed = isAllowedOrigin(origin, accessConfig.allowedOrigins)
    const tokenAuthorized = isAuthorizedToken(token, accessConfig.authToken)

    if (!originAllowed || !tokenAuthorized) {
      console.warn('[ws] rejected unauthorized websocket connection')
      socket.close(1008, 'Unauthorized')
      return
    }

    clients.add(socket)
    console.log(`[ws] client connected (total: ${clients.size})`)

    // 新连接发送当前会话历史
    sendTo(socket, {
      id: genMsgId(),
      type: 'conversation.history',
      taskId: '',
      ts: new Date().toISOString(),
      payload: { messages: conversation }
    })

    // 重放尚在排队 / 执行中的用户消息，避免重连客户端丢失未完成的 turn
    for (const [taskId, content] of pendingUserTurns) {
      sendTo(socket, {
        id: genMsgId(),
        type: 'task.ack',
        taskId,
        ts: new Date().toISOString(),
        payload: { content }
      })
    }

    socket.on('message', (raw: Buffer) => {
      try {
        const data = JSON.parse(raw.toString())
        handleClientMessage(data)
      } catch {
        console.error('[ws] failed to parse message')
        sendTo(socket, {
          id: genMsgId(),
          type: 'task.error',
          taskId: '',
          ts: new Date().toISOString(),
          payload: { code: 'INVALID_MESSAGE', message: '消息格式无效，请重试' }
        })
      }
    })

    socket.on('close', () => {
      clients.delete(socket)
      console.log(`[ws] client disconnected (total: ${clients.size})`)
    })
  })
}

function handleClientMessage(
  msg: { type: string; taskId: string; payload?: Record<string, unknown> }
): void {
  switch (msg.type) {
    case 'task.create': {
      const content = (msg.payload?.content as string) ?? ''

      // 用户消息不在入队时追加到 conversation — 由 pushMessages 在任务成功后原子追加，
      // 避免排队任务的 user 消息插入到前序任务的 assistant 回复之前导致历史错序

      // 入队 Task Coordinator（串行执行）
      let streamNotified = false
      const accepted = coordinator.enqueue(msg.taskId, content, {
        onToken(delta) {
          if (!streamNotified) {
            streamNotified = true
            emotionService.notifyStreamStart()
          }
          broadcast({
            id: genMsgId(),
            type: 'task.token',
            taskId: msg.taskId,
            ts: new Date().toISOString(),
            payload: { delta }
          })
        },
        onStatus(text) {
          broadcast({
            id: genMsgId(),
            type: 'task.status',
            taskId: msg.taskId,
            ts: new Date().toISOString(),
            payload: { text }
          })
        },
        onDone(fullContent) {
          pendingUserTurns.delete(msg.taskId)
          emotionService.notifyTaskCompleted()
          broadcast({
            id: genMsgId(),
            type: 'task.done',
            taskId: msg.taskId,
            ts: new Date().toISOString(),
            payload: { content: fullContent }
          })
        },
        onError(code, message) {
          pendingUserTurns.delete(msg.taskId)
          emotionService.notifyStreamEnd()
          broadcast({
            id: genMsgId(),
            type: 'task.error',
            taskId: msg.taskId,
            ts: new Date().toISOString(),
            payload: { code, message }
          })
        },
        onCancelled() {
          pendingUserTurns.delete(msg.taskId)
          emotionService.notifyStreamEnd()
          broadcast({
            id: genMsgId(),
            type: 'task.cancelled',
            taskId: msg.taskId,
            ts: new Date().toISOString(),
            payload: {}
          })
        }
      })

      if (!accepted) {
        // 入队失败 — 用户消息未写入 conversation，无需回滚
        broadcast({
          id: genMsgId(),
          type: 'task.error',
          taskId: msg.taskId,
          ts: new Date().toISOString(),
          payload: { code: 'QUEUE_FULL', message: '任务队列已满，请稍后再试' }
        })
        break
      }

      // 入队成功 — 磁盘写入已推迟到 onDone（pushMessages 回调）
      pendingUserTurns.set(msg.taskId, content)
      emotionService.notifyUserMessage()

      // 广播 ack（附带 content 以便其他窗口同步用户消息）
      broadcast({
        id: genMsgId(),
        type: 'task.ack',
        taskId: msg.taskId,
        ts: new Date().toISOString(),
        payload: { content }
      })
      break
    }
    case 'task.cancel': {
      coordinator.cancel(msg.taskId)
      break
    }
    default:
      console.warn('[ws] unknown message type:', msg.type)
  }
}
