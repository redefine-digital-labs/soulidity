export interface WalletActionStateInput {
  hasActiveWallet: boolean
  hasSessionWallet: boolean
  walletRestoring: boolean
  busy: boolean
  balanceBlocked: boolean
  txDigest: string | null
  recovery: boolean
  busyLabel?: string | null
  readyLabel?: string
  recoveryReadyLabel?: string
  reconnectLabel?: string
  connectLabel?: string
}

export interface WalletActionState {
  disabled: boolean
  label: string
  needsWalletReconnect: boolean
}

export function getWalletActionState(input: WalletActionStateInput): WalletActionState {
  const readyLabel = input.readyLabel ?? 'Sign & Deploy'
  const recoveryReadyLabel = input.recoveryReadyLabel ?? 'Resume Sync'
  const reconnectLabel = input.reconnectLabel ?? 'Reconnect Sui Wallet'
  const connectLabel = input.connectLabel ?? 'Connect Sui Wallet'

  if (!input.hasActiveWallet) {
    if (input.walletRestoring) {
      return {
        disabled: true,
        label: 'Restoring Sui Wallet...',
        needsWalletReconnect: false,
      }
    }

    return {
      disabled: false,
      label: input.hasSessionWallet ? reconnectLabel : connectLabel,
      needsWalletReconnect: true,
    }
  }

  if (input.recovery) {
    if (!input.txDigest) {
      return {
        disabled: true,
        label: 'Loading recovery...',
        needsWalletReconnect: false,
      }
    }
    if (input.busy) {
      return {
        disabled: true,
        label: input.busyLabel || 'Working...',
        needsWalletReconnect: false,
      }
    }
    return {
      disabled: false,
      label: recoveryReadyLabel,
      needsWalletReconnect: false,
    }
  }

  if (input.balanceBlocked) {
    return {
      disabled: true,
      label: 'Insufficient Balance',
      needsWalletReconnect: false,
    }
  }

  if (input.busy) {
    return {
      disabled: true,
      label: input.busyLabel || 'Working...',
      needsWalletReconnect: false,
    }
  }

  return {
    disabled: false,
    label: readyLabel,
    needsWalletReconnect: false,
  }
}
