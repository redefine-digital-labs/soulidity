import type { ChildProcess } from 'node:child_process'
import type { Duplex } from 'node:stream'

// Only for the isolated Chrome processes spawned by browser tests.
export function chromeCdp(chrome: ChildProcess, label: string, commandTimeoutMs = 4000) {
  const input = chrome.stdio[3] as Duplex, output = chrome.stdio[4] as Duplex
  const pending = new Map<number, { method: string; session?: string; resolve: (value: any) => void;
    reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  let nextId = 0, bytes = Buffer.alloc(0), stderr = '', closed: Error | undefined
  const diagnostics = () => `${label}; pending=${[...pending.values()].map(x => x.method).join(',')}; stderr=${stderr}`
  const fail = (error: Error) => {
    closed ??= error
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(error) }
    pending.clear()
  }
  // Draining this pipe prevents Chrome from blocking once its stderr buffer fills.
  chrome.stderr?.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4096) })
  chrome.on('error', error => fail(Error(`${error.message}; ${diagnostics()}`)))
  chrome.on('exit', (code, signal) => fail(Error(`Chrome exited (${code}/${signal}); ${diagnostics()}`)))
  input.on('error', error => fail(Error(`Chrome input: ${error.message}; ${diagnostics()}`)))
  output.on('error', error => fail(Error(`Chrome output: ${error.message}; ${diagnostics()}`)))
  output.on('close', () => fail(Error(`Chrome CDP pipe closed; ${diagnostics()}`)))
  output.on('data', (chunk: Buffer) => {
    bytes = Buffer.concat([bytes, chunk])
    for (;;) {
      const end = bytes.indexOf(0); if (end < 0) break
      const wire = bytes.subarray(0, end).toString('utf8'); bytes = bytes.subarray(end + 1)
      if (!wire) continue
      let message: any
      try { message = JSON.parse(wire) } catch { fail(Error(`Invalid Chrome CDP response; ${diagnostics()}`)); return }
      const call = pending.get(message.id)
      if (call) {
        pending.delete(message.id); clearTimeout(call.timer)
        message.error ? call.reject(Error(`${call.method}: ${message.error.message}`)) : call.resolve(message.result)
      } else if (message.method === 'Target.detachedFromTarget') {
        for (const [id, call] of pending) if (call.session === message.params?.sessionId) {
          pending.delete(id); clearTimeout(call.timer); call.reject(Error(`Chrome target detached during ${call.method}`))
        }
      }
    }
  })
  function call(method: string, params: any = {}, session?: string, timeoutMs = commandTimeoutMs): Promise<any> {
    if (closed || chrome.exitCode !== null || chrome.signalCode !== null || input.destroyed) {
      return Promise.reject(closed ?? Error(`Chrome unavailable; ${diagnostics()}`))
    }
    const id = ++nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(Error(`Chrome command timed out: ${method}; ${diagnostics()}`)), timeoutMs)
      pending.set(id, { method, session, resolve, reject, timer })
      input.write(`${JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) })}\0`, error => {
        if (error) fail(Error(`Chrome write failed: ${error.message}; ${diagnostics()}`))
      })
    })
  }
  const exited = () => chrome.exitCode !== null || chrome.signalCode !== null
  async function waitForExit(timeoutMs: number) {
    if (exited()) return
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); chrome.off('exit', done); resolve() }
      const timer = setTimeout(done, timeoutMs)
      chrome.once('exit', done)
      if (exited()) done()
    })
  }
  async function close() {
    try { if (!exited()) await call('Browser.close', {}, undefined, 1000) } catch { /* bounded fallback below */ }
    if (!exited()) { chrome.kill(); await waitForExit(1000) }
    if (!exited()) { chrome.kill('SIGKILL'); await waitForExit(1000) }
    fail(Error(`Chrome test cleanup; ${diagnostics()}`))
    if (!exited()) throw Error(`Isolated Chrome did not exit; ${diagnostics()}`)
  }
  return { call, close, diagnostics }
}
