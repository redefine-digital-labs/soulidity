import type { AgentStatusFile } from '@soulidity/shared'

interface CompatMirrorWriterOptions {
  write: (status: AgentStatusFile) => void
  delayMs?: number
}

export interface CompatMirrorWriter {
  schedule(status: AgentStatusFile): void
  flush(): void
  cancel(): void
}

export function createCompatMirrorWriter(options: CompatMirrorWriterOptions): CompatMirrorWriter {
  const delayMs = options.delayMs ?? 200
  let pending: AgentStatusFile | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!pending) return
    const next = pending
    pending = null
    options.write(next)
  }

  return {
    schedule(status) {
      pending = status
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, delayMs)
    },
    flush,
    cancel() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      pending = null
    },
  }
}
