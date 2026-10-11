// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthoringRecoveryExport } from '../../web/components/souls/authoring-recovery-export'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('downloads the supplied recovery without claiming completion or deleting the local copy', async () => {
  const create = vi.fn(() => 'blob:recovery'), click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() })
  const onExport = vi.fn(async () => ({ text: '{"encrypted":"payload"}', filename: 'recovery.json', isCurrent: () => true }))
  await act(async () => root.render(<AuthoringRecoveryExport disabled={false} onExport={onExport} />))
  await act(async () => host.querySelector('button')!.click())
  expect(onExport).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce()
  expect(create.mock.calls[0][0]).toBeInstanceOf(Blob)
  expect(host.textContent).toContain('local creation records are unchanged')
  expect(host.textContent).toContain('saved transaction signatures')
})
it('busy state prevents export and a blocked download reports an actionable error', async () => {
  const onExport = vi.fn(async () => ({ text: '{}', filename: 'recovery.json', isCurrent: () => true }))
  await act(async () => root.render(<AuthoringRecoveryExport disabled onExport={onExport} />))
  await act(async () => host.querySelector('button')!.click()); expect(onExport).not.toHaveBeenCalled()
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => { throw new Error('unavailable') }), revokeObjectURL: vi.fn() })
  await act(async () => root.render(<AuthoringRecoveryExport disabled={false} onExport={onExport} />))
  await act(async () => host.querySelector('button')!.click())
  expect(host.textContent).toContain('Download could not start')
})
it('does not download a late result after wallet change or leaving the page', async () => {
  const create = vi.fn(), click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() })
  let finish!: (result: any) => void
  const onExport = () => new Promise<any>(resolve => { finish = resolve })
  await act(async () => root.render(<AuthoringRecoveryExport disabled={false} onExport={onExport} />))
  await act(async () => host.querySelector('button')!.click())
  await act(async () => finish({ text: '{}', filename: 'recovery.json', isCurrent: () => false }))
  expect(create).not.toHaveBeenCalled()
  await act(async () => host.querySelector('button')!.click())
  await act(async () => root.render(null))
  await act(async () => finish({ text: '{}', filename: 'recovery.json', isCurrent: () => true }))
  expect(create).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled()
})
