/**
 * Filter for noisy `Invalid state: ReadableStream is already closed`
 * unhandled rejections that originate inside undici's deferred body
 * teardown when a fetch handler returns early (4xx) before the request
 * body is read. Three walrus uploader handler tests intentionally exercise
 * that path; on darwin the rejection never surfaces but on Node 24 / linux
 * undici fires a post-test `controller.enqueue` on the now-closed body
 * stream and vitest's immediate `unhandledRejection` listener exits 1
 * (it does this regardless of `dangerouslyIgnoreUnhandledErrors`, which
 * only governs the batched end-of-run check).
 *
 * We swallow only that very specific signature so unrelated unhandled
 * rejections still fail the run as before.
 */

const NOISY_MESSAGE = 'Invalid state: ReadableStream is already closed'
const NOISY_CODE = 'ERR_INVALID_STATE'

function isNoisyUndiciStreamRejection(reason: unknown): boolean {
  if (!reason || typeof reason !== 'object') return false
  const r = reason as { code?: unknown; message?: unknown; stack?: unknown }
  if (r.code !== NOISY_CODE) return false
  if (typeof r.message !== 'string' || !r.message.includes(NOISY_MESSAGE)) return false
  const stack = typeof r.stack === 'string' ? r.stack : ''
  return stack.includes('undici') || stack.includes('webstreams/readablestream')
}

const existingListeners = process.listeners('unhandledRejection').slice()
process.removeAllListeners('unhandledRejection')
process.on('unhandledRejection', (reason, promise) => {
  if (isNoisyUndiciStreamRejection(reason)) {
    return
  }
  for (const listener of existingListeners) {
    try {
      // node's `unhandledRejection` listener signature is (reason, promise)
      ;(listener as (reason: unknown, promise: Promise<unknown>) => void)(reason, promise)
    } catch {
      // a listener throwing must not stop us from forwarding to the next.
    }
  }
})
