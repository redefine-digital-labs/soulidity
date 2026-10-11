import { describe, expect, it } from 'vitest'

import {
  getWalletActionState,
  type WalletActionStateInput,
} from '../../web/lib/wallet/wallet-action-state'

function state(input: Partial<WalletActionStateInput>) {
  return getWalletActionState({
    hasActiveWallet: false,
    hasSessionWallet: false,
    walletRestoring: false,
    busy: false,
    balanceBlocked: false,
    txDigest: null,
    recovery: false,
    ...input,
  })
}

describe('getWalletActionState', () => {
  it('keeps signed-in wallet sessions out of the permanent no-wallet state while auto-connect restores', () => {
    expect(state({
      hasSessionWallet: true,
      walletRestoring: true,
    })).toEqual({
      disabled: true,
      label: 'Restoring Sui Wallet...',
      needsWalletReconnect: false,
    })
  })

  it('offers a reconnect action when the session has a wallet but dapp-kit has no active signer', () => {
    expect(state({
      hasSessionWallet: true,
    })).toEqual({
      disabled: false,
      label: 'Reconnect Sui Wallet',
      needsWalletReconnect: true,
    })
  })

  it('preserves deploy blocking once an active signer is available', () => {
    expect(state({
      hasActiveWallet: true,
      hasSessionWallet: true,
      balanceBlocked: true,
    })).toEqual({
      disabled: true,
      label: 'Insufficient Balance',
      needsWalletReconnect: false,
    })
  })

  it('preserves recovery digest loading once an active signer is available', () => {
    expect(state({
      hasActiveWallet: true,
      hasSessionWallet: true,
      recovery: true,
    })).toEqual({
      disabled: true,
      label: 'Loading recovery...',
      needsWalletReconnect: false,
    })
  })
})
