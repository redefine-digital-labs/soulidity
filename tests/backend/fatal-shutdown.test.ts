import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('backend fatal shutdown handlers', () => {
  it('exits through the runtime shutdown path after capturing fatal errors', () => {
    const source = readSource('src/main.ts')

    expect(source).toContain("process.on('uncaughtException', (error) => {")
    expect(source).toContain("captureFatalException('uncaughtException', error)")
    expect(source).toContain("process.on('unhandledRejection', (reason) => {")
    expect(source).toContain("captureFatalException('unhandledRejection', reason)")

    const uncaughtIndex = source.indexOf("process.on('uncaughtException'")
    const rejectionIndex = source.indexOf("process.on('unhandledRejection'")
    const sigintIndex = source.indexOf("process.on('SIGINT'")

    expect(source.indexOf('void shutdownRuntime(1)', uncaughtIndex)).toBeGreaterThan(uncaughtIndex)
    expect(source.indexOf('void shutdownRuntime(1)', rejectionIndex)).toBeGreaterThan(rejectionIndex)
    expect(source.indexOf('await shutdownRuntime(0)', sigintIndex)).toBeGreaterThan(sigintIndex)
  })

  it('keeps fatal cleanup bounded and flushes telemetry before exit', () => {
    const source = readSource('src/main.ts')
    const shutdownIndex = source.indexOf('async function shutdownRuntime')

    expect(shutdownIndex).toBeGreaterThan(-1)
    expect(source.indexOf('bot?.stop()', shutdownIndex)).toBeGreaterThan(shutdownIndex)
    expect(source.indexOf("withShutdownTimeout('prisma disconnect'", shutdownIndex)).toBeGreaterThan(shutdownIndex)
    expect(source.indexOf("withShutdownTimeout('posthog shutdown'", shutdownIndex)).toBeGreaterThan(shutdownIndex)
    expect(source.indexOf('process.exit(exitCode)', shutdownIndex)).toBeGreaterThan(shutdownIndex)
  })
})
