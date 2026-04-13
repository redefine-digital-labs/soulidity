import { contextBridge, ipcRenderer } from 'electron'

// 通过 contextBridge 向渲染进程安全暴露 IPC 通道
contextBridge.exposeInMainWorld('electronAPI', {
  /** IPC 通路验证 */
  ping: (): Promise<string> => ipcRenderer.invoke('ipc:ping'),
  /** 悬浮球拖拽 */
  dragStart: (): void => { ipcRenderer.send('drag:start') },
  dragMove: (): void => { ipcRenderer.send('drag:move') },
  dragEnd: (): void => { ipcRenderer.send('drag:end') },
  /** 透明区域点击穿透控制 */
  setIgnoreMouseEvents: (ignore: boolean): void => {
    ipcRenderer.send('set-ignore-mouse-events', ignore)
  },
  /** 右键上下文菜单 */
  showContextMenu: (): void => { ipcRenderer.send('contextmenu:show') },
  /** 关闭当前窗口 */
  closeWindow: (): void => { ipcRenderer.send('window:close') },
  /** 本地后端运行时配置 */
  getBackendRuntimeConfig: (): Promise<{
    httpBaseURL: string
    authToken: string
  }> => ipcRenderer.invoke('backend:get-runtime-config'),
  /** 读取配置 */
  getConfig: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('config:get'),
  /** 写入配置 */
  setConfig: (config: Record<string, unknown>): Promise<void> => ipcRenderer.invoke('config:set', config),

  // ── Soulidity: status watcher, agent wallet ─────────────
  /** 监听 agent status 文件变更 */
  onAgentStatusChanged: (callback: (status: unknown) => void): (() => void) => {
    ipcRenderer.on('agent-status-changed', (_e, status) => callback(status))
    return () => { ipcRenderer.removeAllListeners('agent-status-changed') }
  },
  /** 获取当前 agent status */
  getCurrentAgentStatus: (): Promise<unknown> => ipcRenderer.invoke('get-current-agent-status'),
  /** 生成 agent keypair */
  generateAgentKeypair: (): Promise<unknown> => ipcRenderer.invoke('generate-agent-keypair'),
  /** 加载 agent keypair */
  loadAgentKeypair: (): Promise<unknown> => ipcRenderer.invoke('load-agent-keypair'),
  /** 导出 agent 地址 */
  exportAgentAddress: (): Promise<string> => ipcRenderer.invoke('export-agent-address')
})
