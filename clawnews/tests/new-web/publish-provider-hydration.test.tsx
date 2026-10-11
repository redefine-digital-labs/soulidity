// @vitest-environment jsdom

import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

type MockAuthState = {
  user: { id: string } | null
  loading: boolean
  logout: () => Promise<void>
  refresh: () => Promise<void>
  getAuthHeaders: () => Promise<Record<string, string>>
}

const authState: MockAuthState = {
  user: null,
  loading: true,
  logout: async () => {},
  refresh: async () => {},
  getAuthHeaders: async () => ({}),
}

vi.mock('@/components/providers/auth-provider', () => ({
  useAuth: () => authState,
}))

vi.mock('@soulidity/sdk/client-session', () => ({
  attachSoulidityDeploymentSignature: <T extends object>(payload: T) => ({
    ...payload,
    deploymentSignature: 'test-deployment',
  }),
  hasCurrentSoulidityDeploymentSignature: (value: unknown) =>
    Boolean(value) && typeof value === 'object' && (value as { deploymentSignature?: string }).deploymentSignature === 'test-deployment',
}))

type MountedTree = {
  rerender: () => void
  unmount: () => void
}

const mountedTrees: MountedTree[] = []

function mountTree(render: () => React.ReactNode): MountedTree {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)

  const rerender = () => {
    act(() => {
      root.render(render())
    })
  }

  const unmount = () => {
    act(() => {
      root.unmount()
    })
    container.remove()
  }

  rerender()

  const mounted = { rerender, unmount }
  mountedTrees.push(mounted)
  return mounted
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  authState.user = null
  authState.loading = true
  sessionStorage.clear()
})

afterEach(() => {
  while (mountedTrees.length > 0) {
    mountedTrees.pop()?.unmount()
  }
})

describe('publish flow provider hydration', () => {
  it('CreateSoulProvider preserves draft state when auth finishes loading', async () => {
    const { CreateSoulProvider, useCreateSoul } = await import('../../web/components/providers/create-soul-provider')

    let latestCtx: ReturnType<typeof useCreateSoul> | null = null

    function Observer() {
      latestCtx = useCreateSoul()
      return null
    }

    const tree = mountTree(() => (
      <CreateSoulProvider>
        <Observer />
      </CreateSoulProvider>
    ))

    expect(latestCtx?.isHydrated).toBe(false)

    act(() => {
      latestCtx?.setName('Draft soul')
      latestCtx?.setDescription('Draft description')
    })

    authState.user = { id: 'user-1' }
    authState.loading = false
    tree.rerender()

    expect(latestCtx?.isHydrated).toBe(true)
    expect(latestCtx?.name).toBe('Draft soul')
    expect(latestCtx?.description).toBe('Draft description')
  })

  it('ImportSoulProvider preserves draft state when auth finishes loading', async () => {
    const { ImportSoulProvider, useImportSoul } = await import('../../web/components/providers/import-soul-provider')

    let latestCtx: ReturnType<typeof useImportSoul> | null = null

    function Observer() {
      latestCtx = useImportSoul()
      return null
    }

    const tree = mountTree(() => (
      <ImportSoulProvider>
        <Observer />
      </ImportSoulProvider>
    ))

    expect(latestCtx?.isHydrated).toBe(false)

    act(() => {
      latestCtx?.setManualName('Imported soul')
      latestCtx?.setManualDescription('Imported description')
    })

    authState.user = { id: 'user-1' }
    authState.loading = false
    tree.rerender()

    expect(latestCtx?.isHydrated).toBe(true)
    expect(latestCtx?.manualName).toBe('Imported soul')
    expect(latestCtx?.manualDescription).toBe('Imported description')
  })

  it('marks CreateSoulProvider hydrated after auth resolves anonymous', async () => {
    const { CreateSoulProvider, useCreateSoul } = await import('../../web/components/providers/create-soul-provider')

    let latestCtx: ReturnType<typeof useCreateSoul> | null = null

    function Observer() {
      latestCtx = useCreateSoul()
      return null
    }

    const tree = mountTree(() => (
      <CreateSoulProvider>
        <Observer />
      </CreateSoulProvider>
    ))

    expect(latestCtx?.isHydrated).toBe(false)

    authState.user = null
    authState.loading = false
    tree.rerender()

    expect(latestCtx?.isHydrated).toBe(true)
    expect(latestCtx?.publishResult).toBeNull()
  })

  it('marks ImportSoulProvider hydrated after auth resolves anonymous', async () => {
    const { ImportSoulProvider, useImportSoul } = await import('../../web/components/providers/import-soul-provider')

    let latestCtx: ReturnType<typeof useImportSoul> | null = null

    function Observer() {
      latestCtx = useImportSoul()
      return null
    }

    const tree = mountTree(() => (
      <ImportSoulProvider>
        <Observer />
      </ImportSoulProvider>
    ))

    expect(latestCtx?.isHydrated).toBe(false)

    authState.user = null
    authState.loading = false
    tree.rerender()

    expect(latestCtx?.isHydrated).toBe(true)
    expect(latestCtx?.importResult).toBeNull()
  })
})
