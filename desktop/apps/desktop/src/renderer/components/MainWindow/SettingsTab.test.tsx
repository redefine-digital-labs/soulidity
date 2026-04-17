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
  | 'getDesktopAuthStatus'
  | 'getDesktopMe'
  | 'unlinkDesktopDevice'
  | 'deviceStartLink'
  | 'deviceGetLinkUrl'
  | 'devicePoll'
>

function createElectronApi(overrides: Partial<MockElectronApi> = {}): MockElectronApi {
  return {
    loadAgentKeypair: vi.fn().mockResolvedValue({
      address: '0x1234567890abcdef1234567890abcdef',
      publicKey: 'public-key',
      createdAt: Date.parse('2026-04-17T09:30:00Z'),
    }),
    getSecretStorageStatus: vi.fn().mockResolvedValue('encrypted'),
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

  it('confirms immediately after poll and hydrates the Sui address asynchronously', async () => {
    let resolveMe!: (value: DesktopMeResponse) => void

    const api = createElectronApi({
      getDesktopMe: vi.fn().mockImplementation(() => new Promise((resolve) => {
        resolveMe = resolve
      })),
      deviceStartLink: vi.fn().mockResolvedValue({
        userCode: 'UCODE',
        deviceCode: 'DCODE',
        expiresAt: '2026-04-17T10:00:00Z',
        pollInterval: 0.001,
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
      await vi.advanceTimersByTimeAsync(15)
    })

    expect(container.textContent).toContain('Linked to account')
    expect(container.textContent).not.toContain('Waiting for confirmation...')
    expect(findButton(container, 'Cancel')).toBeNull()

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

  })

  it('ignores delayed Sui-address hydration after the user unlinks the confirmed device', async () => {
    let resolveMe!: (value: DesktopMeResponse) => void

    const api = createElectronApi({
      getDesktopMe: vi.fn().mockImplementation(() => new Promise((resolve) => {
        resolveMe = resolve
      })),
      deviceStartLink: vi.fn().mockResolvedValue({
        userCode: 'UCODE',
        deviceCode: 'DCODE',
        expiresAt: '2026-04-17T10:00:00Z',
        pollInterval: 0.001,
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
      await vi.advanceTimersByTimeAsync(15)
    })

    const unlinkButton = findButton(container, 'Unlink Device')
    expect(unlinkButton).not.toBeNull()
    await act(async () => {
      unlinkButton?.click()
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
})
