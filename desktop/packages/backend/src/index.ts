// Backend — 纯 Service 导出层（无 HTTP 服务器）
// Services 由 Electron 主进程通过 IPC 调用

import { memoryService } from './memory/memory-service'
import { greetingService } from './memory/greeting-service'
import { moodService } from './memory/mood-service'
import { initDataDir } from './paths'

// ── Service 实例导出 ──

export { moodService } from './memory/mood-service'
export { greetingService } from './memory/greeting-service'
export { memoryService } from './memory/memory-service'
export { initDataDir, copyInitialTemplates, getPersonaDir, prepareBuiltinPersonaTemplates } from './paths'
export { analyzeSoulProfile } from './analysis/profile-analyzer'

// ── 生命周期 ──

/** 初始化数据目录 + 启动所有 service */
export async function bootServices(dataDir?: string): Promise<void> {
  if (dataDir) initDataDir(dataDir)

  moodService.start()
  await memoryService.boot()
  await greetingService.init()

  console.log('[backend] services booted')
}

/** 停止所有 service */
export function shutdownServices(): void {
  moodService.stop()
  console.log('[backend] services stopped')
}

/** 日终归档 */
export async function sealDay(): Promise<void> {
  await memoryService.sealDay()
}
