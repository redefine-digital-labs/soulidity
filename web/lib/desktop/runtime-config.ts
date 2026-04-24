export type DesktopRuntimeConfig = {
  privyAppId: string | null
  suiNetwork: string
  desktopWalletAuthReady: boolean
  walletAuthMessage: string | null
}

export function getDesktopRuntimeConfig(env: NodeJS.ProcessEnv = process.env): DesktopRuntimeConfig {
  const privyAppId = env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || null
  const suiNetwork = env.NEXT_PUBLIC_SUI_NETWORK?.trim() || 'testnet'
  const hasDesktopTokenSigning = Boolean(env.PRIVY_CUSTOM_AUTH_PRIVATE_KEY_PEM?.trim())
  const desktopWalletAuthReady = Boolean(privyAppId && hasDesktopTokenSigning)
  let walletAuthMessage: string | null = null

  if (!privyAppId) {
    walletAuthMessage = 'This web deployment does not have desktop wallet auth enabled yet.'
  } else if (!hasDesktopTokenSigning) {
    walletAuthMessage = 'This web deployment cannot issue desktop wallet tokens yet. Configure desktop custom auth signing and redeploy.'
  }

  return {
    privyAppId,
    suiNetwork,
    desktopWalletAuthReady,
    walletAuthMessage,
  }
}
