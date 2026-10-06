import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { chromeCdp } from '../helpers/chrome-cdp'

function browser(timeout = 50) {
  const process = Object.assign(new EventEmitter(), {
    exitCode: null as number | null, signalCode: null as string | null,
    stderr: new PassThrough(), stdio: [null, null, null, new PassThrough(), new PassThrough()],
    kill: vi.fn((signal = 'SIGTERM') => {
      process.signalCode = signal; process.emit('exit', null, signal); return true
    }),
  })
  const input = process.stdio[3]!, output = process.stdio[4]!
  const commands: any[] = []
  input.on('data', chunk => commands.push(JSON.parse(String(chunk).replace(/\0$/, ''))))
  const connection = chromeCdp(process as unknown as ChildProcess, 'test browser', timeout)
  return { process, input, output, commands, connection }
}
afterEach(() => vi.useRealTimers())

it('waits for one startup handshake beyond the command budget, then keeps command timeouts short', async () => {
  vi.useFakeTimers()
  const b = browser()
  const ready = b.connection.ready(200)
  expect(b.connection.ready(200)).toBe(ready)
  await vi.advanceTimersByTimeAsync(150)
  expect(b.commands.map(x => x.method)).toEqual(['Browser.getVersion'])
  b.output.write(JSON.stringify({ id: b.commands[0].id, result: { product: 'Chrome/test' } }) + '\0')
  await ready
  const command = expect(b.connection.call('Target.createTarget')).rejects.toThrow('Chrome command timed out: Target.createTarget')
  await vi.advanceTimersByTimeAsync(50)
  await command
  await b.connection.close()
  expect(b.process.kill).toHaveBeenCalledOnce()
})

it('bounds a browser that never becomes ready without retrying startup or leaking the child', async () => {
  vi.useFakeTimers()
  const b = browser()
  const ready = expect(b.connection.ready(200)).rejects.toThrow('Chrome command timed out: Browser.getVersion')
  await vi.advanceTimersByTimeAsync(200)
  await ready
  await expect(b.connection.ready()).rejects.toThrow('Browser.getVersion')
  await expect(b.connection.call('Target.createTarget')).rejects.toThrow('Browser.getVersion')
  expect(b.commands.map(x => x.method)).toEqual(['Browser.getVersion'])
  await b.connection.close()
  expect(b.process.kill).toHaveBeenCalledOnce()
})

it('rejects startup immediately when the spawned browser exits', async () => {
  const b = browser()
  const ready = expect(b.connection.ready()).rejects.toThrow('Chrome exited')
  b.process.exitCode = 1; b.process.emit('exit', 1, null)
  await ready
  await b.connection.close()
  expect(b.process.kill).not.toHaveBeenCalled()
})

it('drains stderr with bounded diagnostics and preserves UTF-8 across CDP chunks', async () => {
  const b = browser()
  b.process.stderr.write('x'.repeat(8192) + 'stderr tail')
  expect(b.process.stderr.readableFlowing).toBe(true)
  expect(b.connection.diagnostics()).toContain('stderr tail')
  expect(b.connection.diagnostics().length).toBeLessThan(4200)
  const result = b.connection.call('Runtime.evaluate', {}, 'session')
  const packet = Buffer.from(JSON.stringify({ id: b.commands[0].id, result: { text: '素材' } }) + '\0')
  const split = packet.indexOf(Buffer.from('素')) + 1
  b.output.write(packet.subarray(0, split)); b.output.write(packet.subarray(split))
  await expect(result).resolves.toEqual({ text: '素材' })
  b.process.exitCode = 0; b.process.emit('exit', 0, null)
})

it('times out a stalled pipe, rejects every pending call and still kills the exact child', async () => {
  vi.useFakeTimers()
  const b = browser()
  const results = Promise.allSettled([b.connection.call('Target.createTarget'), b.connection.call('Runtime.evaluate')])
  await vi.advanceTimersByTimeAsync(50)
  for (const result of await results) {
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected') expect(result.reason.message).toContain('Chrome command timed out: Target.createTarget')
  }
  await expect(b.connection.call('Browser.close')).rejects.toThrow('timed out')
  await b.connection.close()
  expect(b.process.kill).toHaveBeenCalledOnce()
})

it('does not hang when cleanup starts after the child already exited', async () => {
  const b = browser()
  const pending = expect(b.connection.call('Runtime.evaluate')).rejects.toThrow('Chrome exited')
  b.process.signalCode = 'SIGKILL'; b.process.emit('exit', null, 'SIGKILL')
  await pending
  await expect(b.connection.call('Browser.close')).rejects.toThrow('Chrome exited')
  await b.connection.close()
  expect(b.process.kill).not.toHaveBeenCalled()
})

it('bounds an unresponsive Browser.close before terminating its isolated child', async () => {
  vi.useFakeTimers()
  const b = browser()
  const cleanup = b.connection.close()
  await vi.advanceTimersByTimeAsync(1000)
  await cleanup
  expect(b.commands.map(x => x.method)).toEqual(['Browser.close'])
  expect(b.process.kill).toHaveBeenCalledOnce()
})

it('rejects detached-session work without rejecting another tab', async () => {
  const b = browser()
  const detached = expect(b.connection.call('Runtime.evaluate', {}, 'old')).rejects.toThrow('target detached')
  const active = b.connection.call('Runtime.evaluate', {}, 'new')
  b.output.write(JSON.stringify({ method: 'Target.detachedFromTarget', params: { sessionId: 'old' } }) + '\0')
  b.output.write(JSON.stringify({ id: b.commands[1].id, result: { ok: true } }) + '\0')
  await detached; await expect(active).resolves.toEqual({ ok: true })
  b.process.exitCode = 0; b.process.emit('exit', 0, null)
})
