// @vitest-environment jsdom

import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('../../desktop/apps/desktop/src/renderer/components/MainWindow/SettingsTab', () => ({
  SettingsTab: () => <div data-testid="settings-tab">settings</div>,
}))

vi.mock('../../desktop/apps/desktop/src/renderer/components/MainWindow/LibraryTab', () => ({
  LibraryTab: () => <div data-testid="library-tab">library</div>,
}))

vi.mock('../../desktop/apps/desktop/src/renderer/components/MainWindow/AgentTab', () => ({
  AgentTab: () => <div data-testid="agent-tab">agent</div>,
}))

vi.mock('../../desktop/apps/desktop/src/renderer/components/MainWindow/ExtractTab', () => ({
  ExtractTab: () => <div data-testid="extract-tab">extract</div>,
}))

import { MainWindow } from '../../desktop/apps/desktop/src/renderer/components/MainWindow'

function flushPromises() {
  return Promise.resolve()
}

describe('MainWindow', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    window.electronAPI = {
      closeWindow: vi.fn(),
    } as typeof window.electronAPI
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
      await flushPromises()
    })
    container.remove()
    vi.clearAllMocks()
  })

  it('switches from Settings to Extract when the tab is clicked', async () => {
    await act(async () => {
      root.render(<MainWindow />)
      await flushPromises()
    })

    expect(container.querySelector('[data-testid="settings-tab"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="extract-tab"]')).toBeNull()

    const extractButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Extract',
    )
    expect(extractButton).toBeDefined()

    await act(async () => {
      extractButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
    })

    expect(container.querySelector('[data-testid="settings-tab"]')).toBeNull()
    expect(container.querySelector('[data-testid="extract-tab"]')).not.toBeNull()
  })
})
