// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsTab } from './SettingsTab'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type DesktopAuthStatus = {
  hasToken: boolean
  accountId: string | null
}

type DesktopMeResponse = {
  profile: {
    accountId: string
    primarySuiAddress: string | null
  }
  activePersona: null
}

type MockElectronApi = Pick<
  Window['electronAPI'],
  | 'loadAgentKeypair'
  | 'getSecretStorageStatus'
  | 'getConfig'
  | 'setConfig'
  | 'onConfigChanged'
  | 'getDesktopAuthStatus'
  | 'getDesktopMe'
  | 'unlinkDesktopDevice'
  | 'deviceStartLink'
  | 'deviceGetLinkUrl'
  | 'devicePoll'
  | 'walletGetInfo'
  | 'walletGenerate'
  | 'walletImport'
  | 'walletReset'
>

function createElectronApi(overrides: Partial<MockElectronApi> = {}): MockElectronApi {
  return {
    loadAgentKeypair: vi.fn().mockResolvedValue({
      address: '0x1234567890abcdef1234567890abcdef',
      publicKey: 'public-key',
      createdAt: Date.parse('2026-04-17T09:30:00Z'),
    }),
    getSecretStorageStatus: vi.fn().mockResolvedValue('encrypted'),
    getConfig: vi.fn().mockResolvedValue({ petEnhancedMotion: false }),
    setConfig: vi.fn().mockResolvedValue(undefined),
    onConfigChanged: vi.fn().mockReturnValue(() => {}),
    getDesktopAuthStatus: vi.fn().mockResolvedValue({ hasToken: false, accountId: null }),
    getDesktopMe: vi.fn().mockResolvedValue({
      profile: {
        accountId: '0xabcdef1234567890',
        primarySuiAddress: null,
      },
      activePersona: null,
    }),
    unlinkDesktopDevice: vi.fn().mockResolvedValue({ ok: true }),
    deviceStartLink: vi.fn(),
    deviceGetLinkUrl: vi.fn(),
    devicePoll: vi.fn(),
    walletGetInfo: vi.fn().mockResolvedValue(null),
    walletGenerate: vi.fn(),
    walletImport: vi.fn(),
    walletReset: vi.fn(),
    ...overrides,
  }
}

function flushEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function findButton(container: HTMLDivElement, label: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.includes(label),
  ) ?? null
}

describe('SettingsTab desktop auth restore', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount()
      })
    }
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function renderWithApi(api: MockElectronApi) {
    Object.defineProperty(window, 'electronAPI', {
      value: api as unknown as Window['electronAPI'],
      configurable: true,
    })
    root = createRoot(container)

    await act(async () => {
      root.render(<SettingsTab />)
      await flushEffects()
      await flushEffects()
    })
  }

  it('does not render the removed key metadata fields', async () => {
    const api = createElectronApi()

    await renderWithApi(api)

    expect(container.textContent).not.toContain('Created')
    expect(container.textContent).not.toContain('Key Storage')
  })

  it('restores confirmed state from desktop auth even when metadata is missing', async () => {
    const api = createElectronApi({
      getDesktopAuthStatus: vi.fn().mockResolvedValue({ hasToken: true, accountId: null }),
      getDesktopMe: vi.fn().mockResolvedValue({
        profile: {
          accountId: '0xfeedfacecafebeef',
          primarySuiAddress: null,
        },
        activePersona: null,
      }),
    })

    await renderWithApi(api)

    expect(api.getDesktopMe).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Linked to account')
    expect(container.textContent).toContain('Unlink Device')
    // suiAddress missing → fall back to accountId in the address field
    const restoredAccountInput = container.querySelector('input[title="0xfeedfacecafebeef"]')
    expect(restoredAccountInput).not.toBeNull()
  })

  it('prefers the Sui wallet address over the account id when both are present', async () => {
    const api = createElectronApi({
      getDesktopAuthStatus: vi.fn().mockResolvedValue({ hasToken: true, accountId: 'acct_cuid_1234' }),
      getDesktopMe: vi.fn().mockResolvedValue({
        profile: {
          accountId: 'acct_cuid_1234',
          primarySuiAddress: '0x1111111111111111111111111111111111111111111111111111111111111111',
        },
        activePersona: null,
      }),
    })

    await renderWithApi(api)

    expect(container.textContent).toContain('Linked to Sui wallet')
    expect(container.textContent).not.toContain('Linked to account')
    const suiInput = container.querySelector(
      'input[title="0x1111111111111111111111111111111111111111111111111111111111111111"]',
    )
    expect(suiInput).not.toBeNull()
    expect(container.querySelector('input[title="acct_cuid_1234"]')).toBeNull()
  })

  it('shows recovery state instead of confirmed when saved token can no longer be verified', async () => {
    const api = createElectronApi({
      getDesktopAuthStatus: vi.fn().mockResolvedValue({ hasToken: true, accountId: '0xdeadbeefcafebabe' }),
      getDesktopMe: vi.fn().mockRejectedValue(new Error('Invalid desktop access token')),
    })

    await renderWithApi(api)

    expect(api.getDesktopMe).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain('Linked to account')
    expect(container.textContent).toContain('Unlink Device')
    expect(container.textContent).toContain('Saved desktop link could not be verified')
    expect(container.textContent).not.toContain('Try Again')
  })

  it('stays idle without verifying remote auth when no token is persisted', async () => {
    const api = createElectronApi({
      getDesktopAuthStatus: vi.fn().mockResolvedValue({ hasToken: false, accountId: null }),
    })

    await renderWithApi(api)

    expect(api.getDesktopMe).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Link to Web Account')
    expect(container.textContent).not.toContain('Unlink Device')
  })

  it('waits for getDesktopMe verification before showing the confirmed state after poll confirmation', async () => {
    let resolveMe!: (value: DesktopMeResponse) => void

    const api = createElectronApi({
      getDesktopMe: vi.fn().mockImplementation(() => new Promise((resolve) => {
        resolveMe = resolve
      })),
      deviceStartLink: vi.fn().mockResolvedValue({
        userCode: 'UCODE',
        deviceCode: 'DCODE',
        expiresAt: '2026-04-17T10:00:00Z',
        pollInterval: 0.05,
      }),
      deviceGetLinkUrl: vi.fn().mockResolvedValue('http://link'),
      devicePoll: vi.fn().mockResolvedValue({ status: 'confirmed', accountId: 'acct_cuid_1234' }),
    })

    await renderWithApi(api)
    vi.useFakeTimers()

    const linkButton = findButton(container, 'Link to Web Account')
    expect(linkButton).not.toBeNull()
    await act(async () => {
      linkButton?.click()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60)
    })

    expect(container.textContent).toContain('Verifying linked account...')
    expect(container.textContent).not.toContain('Linked to account')
    expect(container.textContent).not.toContain('Linked to Sui wallet')
    expect(findButton(container, 'Cancel')).not.toBeNull()

    await act(async () => {
      resolveMe({
        profile: {
          accountId: 'acct_cuid_1234',
          primarySuiAddress: '0x1111111111111111111111111111111111111111111111111111111111111111',
        },
        activePersona: null,
      })
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Linked to Sui wallet')
    expect(container.textContent).not.toContain('Verifying linked account...')
    expect(findButton(container, 'Cancel')).toBeNull()
  })

  it('retries confirmed polling until getDesktopMe validation succeeds', async () => {
    const api = createElectronApi({
      getDesktopMe: vi.fn()
        .mockRejectedValueOnce(new Error('Desktop auth token is missing. Link this desktop again from Settings.'))
        .mockResolvedValueOnce({
          profile: {
            accountId: 'acct_cuid_1234',
            primarySuiAddress: '0x1111111111111111111111111111111111111111111111111111111111111111',
          },
          activePersona: null,
        }),
      deviceStartLink: vi.fn().mockResolvedValue({
        userCode: 'UCODE',
        deviceCode: 'DCODE',
        expiresAt: '2026-04-17T10:00:00Z',
        pollInterval: 0.05,
      }),
      deviceGetLinkUrl: vi.fn().mockResolvedValue('http://link'),
      devicePoll: vi.fn().mockResolvedValue({ status: 'confirmed', accountId: 'acct_cuid_1234' }),
    })

    await renderWithApi(api)
    vi.useFakeTimers()

    const linkButton = findButton(container, 'Link to Web Account')
    expect(linkButton).not.toBeNull()
    await act(async () => {
      linkButton?.click()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60)
    })

    expect(api.devicePoll).toHaveBeenCalledTimes(1)
    expect(api.getDesktopMe).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain('Linked to account')
    expect(container.textContent).not.toContain('Linked to Sui wallet')
    expect(container.textContent).toContain('Verifying linked account...')
    expect(container.textContent).not.toContain('Saved desktop link could not be verified')
    expect(findButton(container, 'Cancel')).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60)
    })

    expect(api.devicePoll).toHaveBeenCalledTimes(2)
    expect(api.getDesktopMe).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Linked to Sui wallet')
    expect(container.textContent).not.toContain('Verifying linked account...')
  })

  it('ignores a delayed confirmed poll that lands after the user cancels linking', async () => {
    let resolvePoll!: (value: { status: string; accountId?: string }) => void
    const devicePoll = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolvePoll = resolve }),
    )

    const api = createElectronApi({
      deviceStartLink: vi.fn().mockResolvedValue({
        userCode: 'UCODE',
        deviceCode: 'DCODE',
        expiresAt: '2026-04-17T10:00:00Z',
        pollInterval: 60,
      }),
      deviceGetLinkUrl: vi.fn().mockResolvedValue('http://link'),
      devicePoll,
    })

    await renderWithApi(api)
    vi.useFakeTimers()

    const linkButton = findButton(container, 'Link to Web Account')
    expect(linkButton).not.toBeNull()
    await act(async () => {
      linkButton?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    // One poll tick fires but its promise stays pending — UI remains in `linking`.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 1000)
    })
    expect(devicePoll).toHaveBeenCalledTimes(1)

    const cancelButton = findButton(container, 'Cancel')
    expect(cancelButton).not.toBeNull()
    await act(async () => {
      cancelButton?.click()
    })
    expect(container.textContent).toContain('Link to Web Account')
    expect(container.textContent).not.toContain('Waiting for confirmation')

    // Poll resolves `confirmed` AFTER cancel — must be rejected by the nonce guard.
    await act(async () => {
      resolvePoll({ status: 'confirmed', accountId: 'acct_cuid_1234' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Link to Web Account')
    expect(container.textContent).not.toContain('Linked to Sui wallet')
    expect(container.textContent).not.toContain('Linked to account')
  })

  it('ignores delayed getDesktopMe verification after the user cancels linking', async () => {
    let resolveMe!: (value: DesktopMeResponse) => void

    const api = createElectronApi({
      getDesktopMe: vi.fn().mockImplementation(() => new Promise((resolve) => {
        resolveMe = resolve
      })),
      deviceStartLink: vi.fn().mockResolvedValue({
        userCode: 'UCODE',
        deviceCode: 'DCODE',
        expiresAt: '2026-04-17T10:00:00Z',
        pollInterval: 0.05,
      }),
      deviceGetLinkUrl: vi.fn().mockResolvedValue('http://link'),
      devicePoll: vi.fn().mockResolvedValue({ status: 'confirmed', accountId: 'acct_cuid_1234' }),
      unlinkDesktopDevice: vi.fn().mockResolvedValue({ ok: true }),
    })

    await renderWithApi(api)
    vi.useFakeTimers()

    const linkButton = findButton(container, 'Link to Web Account')
    expect(linkButton).not.toBeNull()
    await act(async () => {
      linkButton?.click()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60)
    })

    const cancelButton = findButton(container, 'Cancel')
    expect(cancelButton).not.toBeNull()
    await act(async () => {
      cancelButton?.click()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Link to Web Account')
    expect(container.textContent).not.toContain('Linked to account')

    await act(async () => {
      resolveMe({
        profile: {
          accountId: 'acct_cuid_1234',
          primarySuiAddress: '0x1111111111111111111111111111111111111111111111111111111111111111',
        },
        activePersona: null,
      })
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Link to Web Account')
    expect(container.textContent).not.toContain('Linked to Sui wallet')
  })

  it('exposes Generate / Import controls when no desktop Sui wallet exists', async () => {
    const api = createElectronApi({
      walletGetInfo: vi.fn().mockResolvedValue(null),
    })

    await renderWithApi(api)

    expect(api.walletGetInfo).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Desktop Sui Wallet')
    expect(container.textContent).toContain('No desktop Sui wallet is configured yet.')
    expect(findButton(container, 'Generate Sui Wallet')).not.toBeNull()
    expect(findButton(container, 'Import Existing Key')).not.toBeNull()
  })

  it('renders the existing desktop Sui wallet address with a reset control', async () => {
    const api = createElectronApi({
      walletGetInfo: vi.fn().mockResolvedValue({
        address: '0x2222222222222222222222222222222222222222222222222222222222222222',
        publicKey: 'pk',
        createdAt: Date.parse('2026-04-17T09:30:00Z'),
      }),
    })

    await renderWithApi(api)

    const desktopAddrInput = container.querySelector(
      'input[title="0x2222222222222222222222222222222222222222222222222222222222222222"]',
    )
    expect(desktopAddrInput).not.toBeNull()
    expect(findButton(container, 'Reset Desktop Sui Wallet')).not.toBeNull()
    expect(container.textContent).not.toContain('No desktop Sui wallet is configured yet.')
  })

  it('warns when the desktop Sui wallet does not match the linked primary Sui address', async () => {
    const api = createElectronApi({
      getDesktopAuthStatus: vi.fn().mockResolvedValue({ hasToken: true, accountId: 'acct_cuid_1234' }),
      getDesktopMe: vi.fn().mockResolvedValue({
        profile: {
          accountId: 'acct_cuid_1234',
          primarySuiAddress: '0x1111111111111111111111111111111111111111111111111111111111111111',
        },
        activePersona: null,
      }),
      walletGetInfo: vi.fn().mockResolvedValue({
        address: '0x2222222222222222222222222222222222222222222222222222222222222222',
        publicKey: 'pk',
        createdAt: Date.parse('2026-04-17T09:30:00Z'),
      }),
    })

    await renderWithApi(api)

    expect(container.textContent).toContain('Linked to Sui wallet')
    expect(container.textContent).toContain('does not match the bound primary Sui wallet')
  })

  it('replaces the panel with the freshly generated wallet after Generate Sui Wallet succeeds', async () => {
    const generated = {
      address: '0x3333333333333333333333333333333333333333333333333333333333333333',
      publicKey: 'pk-gen',
      createdAt: Date.parse('2026-04-17T09:30:00Z'),
    }
    const api = createElectronApi({
      walletGetInfo: vi.fn().mockResolvedValue(null),
      walletGenerate: vi.fn().mockResolvedValue(generated),
    })

    await renderWithApi(api)

    const generateButton = findButton(container, 'Generate Sui Wallet')
    expect(generateButton).not.toBeNull()
    await act(async () => {
      generateButton?.click()
      await flushEffects()
    })

    expect(api.walletGenerate).toHaveBeenCalledTimes(1)
    expect(container.querySelector(`input[title="${generated.address}"]`)).not.toBeNull()
    expect(findButton(container, 'Reset Desktop Sui Wallet')).not.toBeNull()
  })

  it('imports a pasted private key through walletImport and re-renders with the new address', async () => {
    const imported = {
      address: '0x4444444444444444444444444444444444444444444444444444444444444444',
      publicKey: 'pk-import',
      createdAt: Date.parse('2026-04-17T09:30:00Z'),
    }
    const api = createElectronApi({
      walletGetInfo: vi.fn().mockResolvedValue(null),
      walletImport: vi.fn().mockResolvedValue(imported),
    })

    await renderWithApi(api)

    const importButton = findButton(container, 'Import Existing Key')
    expect(importButton).not.toBeNull()
    await act(async () => {
      importButton?.click()
      await flushEffects()
    })

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement | null
    expect(textarea).not.toBeNull()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, 'suiprivkey1qqqqqqqqqqqqqqq')
      textarea!.dispatchEvent(new Event('input', { bubbles: true }))
      await flushEffects()
    })

    const submitButton = findButton(container, 'Import Key')
    expect(submitButton).not.toBeNull()
    await act(async () => {
      submitButton?.click()
      await flushEffects()
    })

    expect(api.walletImport).toHaveBeenCalledWith('suiprivkey1qqqqqqqqqqqqqqq')
    expect(container.querySelector(`input[title="${imported.address}"]`)).not.toBeNull()
  })

  it('persists the enhanced motion toggle through desktop config', async () => {
    const api = createElectronApi({
      getConfig: vi.fn().mockResolvedValue({ petEnhancedMotion: false }),
      setConfig: vi.fn().mockResolvedValue(undefined),
    })

    await renderWithApi(api)

    expect(container.textContent).toContain('Low disturbance')
    const toggleButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Off',
    )
    expect(toggleButton).not.toBeNull()

    await act(async () => {
      toggleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    expect(api.setConfig).toHaveBeenCalledWith({ petEnhancedMotion: true })
  })
})
