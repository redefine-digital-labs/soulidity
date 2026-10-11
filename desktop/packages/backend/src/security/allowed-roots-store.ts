import { resolve } from 'path'

/**
 * 会话级别的额外允许路径（如用户拖入的文件所在目录）
 *
 * 在同一进程中由 Electron main 写入，skill-manager 读取后
 * 通过 ADDITIONAL_ALLOWED_ROOTS 环境变量传递给子进程脚本。
 */
const additionalRoots = new Set<string>()

export function addAllowedRoot(dir: string): void {
  const resolved = resolve(dir)
  if (!additionalRoots.has(resolved)) {
    additionalRoots.add(resolved)
    console.log(`[allowed-roots] added: ${resolved}`)
  }
}

export function getAdditionalAllowedRoots(): string[] {
  return Array.from(additionalRoots)
}
