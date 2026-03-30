// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PublishSoulPage from './page'

const mockedPush = vi.hoisted(() => vi.fn())
const mockedGetAuthHeaders = vi.hoisted(() => vi.fn())
const mockedSignAndExecute = vi.hoisted(() => vi.fn())
const mockedBuildMintAndListSoulTx = vi.hoisted(() => vi.fn())
const mockedMirrorRouteRequest = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockedPush,
  }),
}))

vi.mock('@web/components/auth-provider', () => ({
  useAuth: () => ({
    user: { primarySuiAddress: `0x${'1'.repeat(64)}` },
    getAuthHeaders: mockedGetAuthHeaders,
  }),
}))

vi.mock('@web/components/souls/upload-walrus', () => ({
  UploadWalrus: ({ type, label, onUpload }: {
    type: 'public' | 'encrypted'
    label: string
    onUpload: (result: { blobId: string; blobObjectId: string | null; contentHash: string }) => void
  }) => (
    <button
      type="button"
      data-upload-type={type}
      onClick={() => {
        if (type === 'public') {
          onUpload({
            blobId: 'blob-preview',
            blobObjectId: null,
            contentHash: 'preview-hash',
          })
        }
      }}
    >
      {label}
    </button>
  ),
}))

vi.mock('@web/lib/souls/use-privy-sui', () => ({
  usePrivySuiSign: () => ({
    signAndExecute: mockedSignAndExecute,
  }),
}))

vi.mock('@web/lib/souls/tx-builder', () => ({
  buildMintAndListSoulTx: mockedBuildMintAndListSoulTx,
}))

vi.mock('@web/lib/services/walrus', () => ({
  getBlobUrl: (blobId: string) => `https://walrus.example/${blobId}`,
}))

vi.mock('@web/lib/souls/mirror-sync', () => ({
  mirrorRouteRequest: mockedMirrorRouteRequest,
  formatMirrorSyncError: (error: unknown) => error instanceof Error ? error.message : 'Unknown error',
}))

type MockJsonResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

function createJsonResponse(payload: unknown, status = 200): MockJsonResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

function findControl(container: HTMLElement, labelText: string, selector: string) {
  const label = Array.from(container.querySelectorAll('label'))
    .find((candidate) => candidate.textContent?.includes(labelText))

  if (!label) {
    throw new Error(`Missing label: ${labelText}`)
  }

  const control = label.querySelector(selector)
  if (!control) {
    throw new Error(`Missing control ${selector} for label: ${labelText}`)
  }

  return control
}

describe('PublishSoulPage', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    mockedPush.mockReset()
    mockedGetAuthHeaders.mockReset()
    mockedGetAuthHeaders.mockResolvedValue({ Authorization: 'Bearer test' })
    mockedSignAndExecute.mockReset()
    mockedSignAndExecute.mockResolvedValue({
      digest: '0xdigest',
      objectChanges: [{
        type: 'created',
        objectId: '0xsoul',
        objectType: `${`0x${'9'.repeat(64)}`}::soul::Soul`,
      }],
    })
    mockedBuildMintAndListSoulTx.mockReset()
    mockedBuildMintAndListSoulTx.mockReturnValue({ kind: 'tx' })
    mockedMirrorRouteRequest.mockReset()
    mockedMirrorRouteRequest.mockResolvedValue({})
    process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID = `0x${'9'.repeat(64)}`
    process.env.NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID = `0x${'8'.repeat(64)}`

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/souls/upload') {
        const formData = init?.body as FormData
        const uploadType = formData.get('type')
        if (uploadType === 'public') {
          return createJsonResponse({ blobId: 'blob-metadata' })
        }
        if (uploadType === 'encrypted') {
          const uploadedFile = formData.get('file')
          if (!(uploadedFile instanceof File) || uploadedFile.name !== 'bundle.zip') {
            throw new Error('Expected the raw content file to be uploaded during publish')
          }
          return createJsonResponse({
            blobId: 'blob-content',
            blobObjectId: '0xblob',
            contentHash: 'content-hash',
            sealDekEnvelope: 'envelope',
          })
        }
      }

      if (String(input) === '/api/souls/personal-kiosk') {
        return createJsonResponse({ error: 'missing' }, 404)
      }

      throw new Error(`Unexpected fetch call: ${String(input)}`)
    }) as unknown as typeof fetch

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
  })

  it('keeps the raw content file local until publish, then uploads it as encrypted content', async () => {
    await act(async () => {
      root.render(<PublishSoulPage />)
      await Promise.resolve()
    })

    const setInputValue = async (labelText: string, value: string) => {
      const input = findControl(container, labelText, 'input, textarea') as HTMLInputElement | HTMLTextAreaElement
      const prototype = input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set

      await act(async () => {
        valueSetter?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      })
    }

    await setInputValue('Name', 'Signal Soul')
    await setInputValue('Description', 'Private research bundle')
    await setInputValue('Category', 'Research')
    await setInputValue('Price (USDC)', '1.25')
    await setInputValue('Tags', 'alpha, macro')

    const previewButton = container.querySelector('button[data-upload-type="public"]') as HTMLButtonElement | null
    expect(previewButton).not.toBeNull()
    await act(async () => {
      previewButton?.click()
    })

    const contentInput = findControl(container, 'Content file', 'input[type="file"]') as HTMLInputElement
    const contentFile = new File(['secret bundle'], 'bundle.zip', { type: 'application/zip' })
    Object.defineProperty(contentInput, 'files', {
      configurable: true,
      value: [contentFile],
    })

    await act(async () => {
      contentInput.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(container.textContent).toContain('bundle.zip')

    const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement | null
    expect(submitButton).not.toBeNull()
    const form = submitButton?.form
    expect(form).not.toBeNull()

    await act(async () => {
      form?.requestSubmit(submitButton ?? undefined)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(globalThis.fetch).toHaveBeenCalled()
    expect(mockedBuildMintAndListSoulTx).toHaveBeenCalledWith(expect.objectContaining({
      contentBlobObjectId: '0xblob',
      metadataRef: 'blob-metadata',
    }))
    expect(mockedSignAndExecute).toHaveBeenCalledTimes(1)
    expect(mockedMirrorRouteRequest).toHaveBeenCalledWith(expect.objectContaining({
      input: '/api/souls/publish',
      init: expect.objectContaining({
        method: 'POST',
      }),
    }))
    expect(mockedPush).toHaveBeenCalledWith('/souls/0xsoul')
  })
})
