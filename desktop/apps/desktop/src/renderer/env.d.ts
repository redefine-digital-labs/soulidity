// 渲染进程全局类型声明（由 preload/index.ts 通过 contextBridge 注入）
export {}

declare global {
  interface Window {
    electronAPI: {
      /** IPC 通路验证 */
      ping: () => Promise<string>
      /** 悬浮球拖拽 */
      dragStart: () => void
      dragMove: () => void
      dragEnd: () => void
      /** 透明区域点击穿透控制 */
      setIgnoreMouseEvents: (ignore: boolean) => void
      /** 右键上下文菜单 */
      showContextMenu: () => void
      /** 关闭当前窗口 */
      closeWindow: () => void
      /** 本地后端运行时配置 */
      getBackendRuntimeConfig: () => Promise<{
        httpBaseURL: string
        authToken: string
      }>
      /** 读取配置 */
      getConfig: () => Promise<Record<string, unknown>>
      /** 写入配置 */
      setConfig: (config: Record<string, unknown>) => Promise<void>

      // ── Soulidity: status watcher, agent wallet ─────────
      /** 监听 agent status 文件变更 */
      onAgentStatusChanged: (callback: (status: unknown) => void) => () => void
      /** 获取当前 agent status */
      getCurrentAgentStatus: () => Promise<unknown>
      /** 生成 agent keypair */
      generateAgentKeypair: () => Promise<unknown>
      /** 加载 agent keypair */
      loadAgentKeypair: () => Promise<unknown>
      /** 导出 agent 地址 */
      exportAgentAddress: () => Promise<string>
    }
  }
}
