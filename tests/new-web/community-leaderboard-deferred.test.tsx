// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import LeaderboardPage from '../../web/app/community/leaderboard/page'

vi.mock('next/link', () => ({ default: ({ children, href }: any) => <a href={href}>{children}</a> }))
it('retains the page and dimensions with honest deferred status and no network/query dependency', async () => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const host = document.createElement('div'), root = createRoot(host)
  try {
    await act(async () => root.render(<LeaderboardPage />))
    expect(host.textContent).toContain('Contributor rankings are temporarily unavailable')
    expect(host.textContent).not.toMatch(/No data yet|earn karma|Lv /)
    const tabs = [...host.querySelectorAll('button')]
    expect(tabs.map(tab => tab.textContent)).toEqual(['Most Active', 'Most Helpful'])
    expect(tabs.every(tab => tab.disabled)).toBe(true)
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/community')
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount()); vi.unstubAllGlobals()
  }
})
it('removes both reachable legacy ranking consumers and their obsolete backend route', () => {
  for (const path of ['web/app/community/leaderboard/page.tsx', 'web/app/community/_components/community-feed.tsx']) {
    expect(readFileSync(path, 'utf8')).not.toMatch(/useLeaderboard|api\/community\/leaderboard/)
  }
  expect(existsSync('web/app/api/community/leaderboard/route.ts')).toBe(false)
})
