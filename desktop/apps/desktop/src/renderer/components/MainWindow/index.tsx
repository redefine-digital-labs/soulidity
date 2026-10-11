import React, { useState, useCallback, useEffect } from 'react'
import { SettingsTab } from './SettingsTab'
import { AgentTab } from './AgentTab'
import { LibraryTab } from './LibraryTab'
import { ExtractTab } from './ExtractTab'
import { HooksTab } from './HooksTab'
import './styles.css'

type TabId = 'settings' | 'library' | 'agent' | 'extract' | 'hooks'

const TABS: { id: TabId; label: string }[] = [
  { id: 'settings', label: 'Settings' },
  { id: 'library', label: 'Souls' },
  { id: 'extract', label: 'Forge' },
  { id: 'agent', label: 'Runtime' },
  { id: 'hooks', label: 'Bridges' },
]

const TAB_IDS: readonly TabId[] = ['settings', 'library', 'extract', 'agent', 'hooks']

function isTabId(value: unknown): value is TabId {
  return typeof value === 'string' && (TAB_IDS as readonly string[]).includes(value)
}

export function MainWindow(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('settings')

  const handleClose = useCallback(() => {
    window.electronAPI.closeWindow()
  }, [])

  useEffect(() => {
    const handleDomNavigate = (event: Event) => {
      const nextTab = (event as CustomEvent<{ tab?: string }>).detail?.tab
      if (isTabId(nextTab)) {
        setActiveTab(nextTab)
      }
    }

    const handleElectronNavigate = (detail: { tab?: string }) => {
      const nextTab = detail.tab
      if (isTabId(nextTab)) {
        setActiveTab(nextTab)
      }
    }

    window.addEventListener('desktop:navigate-tab', handleDomNavigate)
    const unsubscribe = window.electronAPI.onNavigateTab(handleElectronNavigate)
    return () => {
      window.removeEventListener('desktop:navigate-tab', handleDomNavigate)
      unsubscribe()
    }
  }, [])

  return (
    <div className="main-window">
      <div className="main-window__header">
        <span className="main-window__title">Soulidity</span>
        <button type="button" className="main-window__close" onClick={handleClose} title="Close">
          ×
        </button>
      </div>

      <nav className="main-window__tabs">
        {TABS.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={`main-window__tab ${activeTab === tab.id ? 'main-window__tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="main-window__body">
        {activeTab === 'settings' && <SettingsTab />}
        {activeTab === 'library' && <LibraryTab />}
        {activeTab === 'extract' && <ExtractTab />}
        {activeTab === 'agent' && <AgentTab />}
        {activeTab === 'hooks' && <HooksTab />}
      </div>
    </div>
  )
}
