import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { Transaction } from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import {
  generateWallet,
  getWalletInfo,
  importWallet,
  resetWallet,
  signPersonalMessage,
  signTransactionBytes,
  type WalletInfo,
} from './wallet-keystore'

type WalletApprovalAction = 'generate' | 'import' | 'reset' | 'sign-message' | 'sign-transaction'

const ACTION_LABELS: Record<WalletApprovalAction, string> = {
  generate: 'Replace desktop wallet',
  import: 'Import desktop wallet',
  reset: 'Reset desktop wallet',
  'sign-message': 'Sign message',
  'sign-transaction': 'Sign Sui transaction',
}

function isTrustedRendererUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false

  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'file:') return true

    const devRendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (devRendererUrl) {
      const devUrl = new URL(devRendererUrl)
      if (url.origin === devUrl.origin) return true
    }

    if (process.env['NODE_ENV'] === 'development') {
      return (url.protocol === 'http:' || url.protocol === 'https:')
        && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')
    }
  } catch {
    return false
  }

  return false
}

function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url || event.sender.getURL()
  if (!isTrustedRendererUrl(senderUrl)) {
    throw new Error('Wallet operation rejected: untrusted renderer origin.')
  }
}

function getParentWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
  if (!parentWindow) {
    throw new Error('Wallet operation rejected: no trusted desktop window is available.')
  }
  return parentWindow
}

function toBytes(input: unknown): Uint8Array {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  }
  throw new Error('Wallet operation rejected: invalid byte payload.')
}

function bytesPreview(bytes: Uint8Array): string {
  return Buffer.from(bytes.slice(0, 24)).toString('hex') + (bytes.byteLength > 24 ? '...' : '')
}

function summarizeTransaction(rawBytes: Uint8Array, walletAddress: string): string {
  let data: ReturnType<Transaction['getData']>
  try {
    data = Transaction.from(rawBytes).getData()
  } catch {
    throw new Error('Wallet operation rejected: transaction bytes could not be read.')
  }

  const txSender = typeof data.sender === 'string' ? normalizeSuiAddress(data.sender) : null
  const signerAddress = normalizeSuiAddress(walletAddress)
  if (!txSender || txSender !== signerAddress) {
    throw new Error('Wallet operation rejected: transaction sender does not match the desktop wallet.')
  }

  const moveCalls = data.commands
    .map((command) => {
      const moveCall = command.MoveCall
      return moveCall
        ? `${moveCall.package}::${moveCall.module}::${moveCall.function}`
        : null
    })
    .filter((target): target is string => typeof target === 'string')
  const moveCallSummary = moveCalls.length > 0
    ? moveCalls.slice(0, 5).map((target) => `- ${target}`).join('\n')
    : '- No Move calls'

  return [
    `Sender: ${txSender}`,
    `Commands: ${data.commands.length}`,
    `Inputs: ${data.inputs.length}`,
    `Gas budget: ${data.gasData.budget ?? 'not set'}`,
    `Gas price: ${data.gasData.price ?? 'not set'}`,
    `Byte length: ${rawBytes.byteLength}`,
    '',
    'Move calls:',
    moveCallSummary,
    moveCalls.length > 5 ? `...and ${moveCalls.length - 5} more` : '',
  ].filter(Boolean).join('\n')
}

async function requireWalletApproval(
  event: IpcMainInvokeEvent,
  action: WalletApprovalAction,
  detail: string,
): Promise<void> {
  assertTrustedRenderer(event)
  const parentWindow = getParentWindow(event)
  const { response } = await dialog.showMessageBox(parentWindow, {
    type: action === 'sign-message' || action === 'sign-transaction' ? 'question' : 'warning',
    buttons: ['Deny', ACTION_LABELS[action]],
    defaultId: 0,
    cancelId: 0,
    title: ACTION_LABELS[action],
    message: `${ACTION_LABELS[action]}?`,
    detail,
    noLink: true,
  })

  if (response !== 1) {
    throw new Error('Wallet operation denied by user.')
  }
}

export function registerWalletIpc(): void {
  ipcMain.handle('wallet:get-info', (): WalletInfo | null => {
    return getWalletInfo()
  })

  ipcMain.handle('wallet:generate', async (event): Promise<WalletInfo> => {
    if (getWalletInfo()) {
      await requireWalletApproval(
        event,
        'generate',
        'This will replace the existing desktop Sui wallet stored on this device. Existing funds and Souls will no longer be controlled unless the old private key was backed up elsewhere.',
      )
    } else {
      assertTrustedRenderer(event)
    }
    return generateWallet()
  })

  ipcMain.handle('wallet:import', async (event, secretKeyInput: string): Promise<WalletInfo> => {
    await requireWalletApproval(
      event,
      'import',
      'This will replace the desktop Sui wallet stored on this device with the private key entered in the app. The private key will not be shown back to renderer JavaScript.',
    )
    return importWallet(secretKeyInput)
  })

  ipcMain.handle('wallet:reset', async (event): Promise<void> => {
    await requireWalletApproval(
      event,
      'reset',
      'This removes the desktop Sui wallet from this device. Funds and Souls remain on-chain, but this app cannot control them again unless the private key is imported.',
    )
    resetWallet()
  })

  ipcMain.handle('wallet:sign-message', async (event, message: Uint8Array | ArrayBuffer): Promise<{ signature: string }> => {
    const bytes = toBytes(message)
    const wallet = getWalletInfo()
    await requireWalletApproval(
      event,
      'sign-message',
      [
        `Wallet: ${wallet?.address ?? 'unknown'}`,
        `Byte length: ${bytes.byteLength}`,
        `Preview: ${bytesPreview(bytes)}`,
      ].join('\n'),
    )
    return signPersonalMessage(bytes)
  })

  ipcMain.handle('wallet:sign-transaction', async (event, rawBytes: Uint8Array | ArrayBuffer): Promise<{ signature: string }> => {
    const bytes = toBytes(rawBytes)
    const wallet = getWalletInfo()
    if (!wallet) {
      throw new Error('Generate or import a wallet before signing transactions.')
    }
    const summary = summarizeTransaction(bytes, wallet.address)
    await requireWalletApproval(event, 'sign-transaction', summary)
    return signTransactionBytes(bytes)
  })
}

export const __testing = {
  isTrustedRendererUrl,
}
