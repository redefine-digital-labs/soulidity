export type DesktopRuntimeConfig = {
  suiNetwork: string
  desktopWalletAuthReady: boolean
  walletAuthMessage: string | null
}

export function getDesktopRuntimeConfig(env: NodeJS.ProcessEnv = process.env): DesktopRuntimeConfig {
  const suiNetwork = env.NEXT_PUBLIC_SUI_NETWORK?.trim() || 'testnet'
  // Desktop now signs wallet challenges with a local Sui keypair held in the
  // Electron main process. The server only needs AUTH_SECRET to verify and
  // issue the resulting browser session cookie.
  const hasAuthSecret = Boolean(env.AUTH_SECRET?.trim())

  return {
    suiNetwork,
    desktopWalletAuthReady: hasAuthSecret,
    walletAuthMessage: hasAuthSecret
      ? null
      : 'AUTH_SECRET is not configured on this web deployment. Wallet sessions cannot be issued.',
  }
}
