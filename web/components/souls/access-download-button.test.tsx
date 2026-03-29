// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccessDownloadButton } from '@web/components/souls/access-download-button'

const mockLoadDecryptedSoulBundle = vi.hoisted(() => vi.fn())
const mockCreateSoulDownloadBlob = vi.hoisted(() => vi.fn(() => new Blob(['bundle'])))
const mockRequirePrimarySuiWallet = vi.hoisted(() => vi.fn((address: string | null | undefined) => {
  if (!address) {
    throw new Error('Bind a Sui wallet before accessing Soul content')
  }
  return address
}))

vi.mock('@mysten/dapp-kit', () => ({
  useSuiClient: () => ({ name: 'sui-client' }),
}))

vi.mock('@web/components/auth-provider', () => ({
  useAuth: () => ({
    getAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer test' })),
    user: { primarySuiAddress: '0x2' },
  }),
}))

vi.mock('@web/lib/souls/use-privy-sui', () => ({
  usePrivySuiSign: () => ({
    signPersonalMessage: vi.fn(async () => 'signature'),
  }),
}))

vi.mock('@web/lib/souls/access-download', () => ({
  loadDecryptedSoulBundle: mockLoadDecryptedSoulBundle,
  createSoulDownloadBlob: mockCreateSoulDownloadBlob,
  requirePrimarySuiWallet: mockRequirePrimarySuiWallet,
  sanitizeDownloadFileName: (value: string) => value,
  scheduleBlobUrlRevoke: vi.fn(),
}))

describe('AccessDownloadButton', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    mockLoadDecryptedSoulBundle.mockReset()
    mockCreateSoulDownloadBlob.mockClear()
    mockRequirePrimarySuiWallet.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  async function renderButton() {
    await act(async () => {
      root.render(<AccessDownloadButton soulObjectId="0x2" />)
    })
    const button = container.querySelector('button')
    expect(button).not.toBeNull()
    return button as HTMLButtonElement
  }

  it('renders the download action', async () => {
    const button = await renderButton()
    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe('Download content')
  })

  it('shows an error when bundle loading fails', async () => {
    mockLoadDecryptedSoulBundle.mockRejectedValueOnce(new Error('Download failed'))
    const button = await renderButton()

    await act(async () => {
      button.click()
      await Promise.resolve()
    })

    expect(container.querySelector('p')?.textContent).toContain('Download failed')
  })

  it('disables the button while the download is in flight', async () => {
    let rejectLoad: ((reason?: unknown) => void) | null = null
    mockLoadDecryptedSoulBundle.mockImplementationOnce(() => new Promise((_, reject) => {
      rejectLoad = reject
    }))
    const button = await renderButton()

    await act(async () => {
      button.click()
      await Promise.resolve()
    })

    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('Decrypting…')

    await act(async () => {
      rejectLoad?.(new Error('Still pending'))
      await Promise.resolve()
    })

    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe('Download content')
  })
})
