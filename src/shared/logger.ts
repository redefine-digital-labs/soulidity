type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PRIORITY: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

function readMinLevel(): Level {
  const raw = (process.env.LOG_LEVEL ?? '').toLowerCase()
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw
  return 'info'
}

const minLevel: Level = readMinLevel()

function emit(level: Level, tag: string, args: unknown[]): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) return
  const sink =
    level === 'error'
      ? console.error
      : level === 'warn'
      ? console.warn
      : level === 'info'
      ? console.info
      : console.log
  sink(`[${tag}]`, ...args)
}

export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  child: (subTag: string) => Logger
}

function makeLogger(tag: string): Logger {
  return {
    debug: (...args) => emit('debug', tag, args),
    info: (...args) => emit('info', tag, args),
    warn: (...args) => emit('warn', tag, args),
    error: (...args) => emit('error', tag, args),
    child: (subTag) => makeLogger(`${tag}:${subTag}`),
  }
}

export const logger = {
  child: (tag: string) => makeLogger(tag),
}
