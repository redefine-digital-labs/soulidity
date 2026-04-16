// @vitest-environment jsdom

import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

import { FilterTabs } from '../../web/components/nav/filter-tabs'

function flushPromises() {
  return Promise.resolve()
}

describe('FilterTabs', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
      await flushPromises()
    })
    container.remove()
    vi.clearAllMocks()
  })

  it('does not call onChange when clicking the already-active tab', async () => {
    const onChange = vi.fn()

    await act(async () => {
      root.render(
        <FilterTabs
          tabs={[
            { id: 'all', label: '全部' },
            { id: 'draft', label: '草稿' },
          ]}
          activeId="all"
          onChange={onChange}
        />,
      )
      await flushPromises()
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    const activeButton = buttons.find((button) => button.textContent === '全部')
    const inactiveButton = buttons.find((button) => button.textContent === '草稿')

    expect(activeButton).toBeTruthy()
    expect(inactiveButton).toBeTruthy()

    await act(async () => {
      activeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
    })

    expect(onChange).not.toHaveBeenCalled()

    await act(async () => {
      inactiveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
    })

    expect(onChange).toHaveBeenCalledWith('draft')
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
