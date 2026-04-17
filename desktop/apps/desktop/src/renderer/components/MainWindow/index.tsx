import React, { useState, useCallback, useEffect } from 'react'
import { SettingsTab } from './SettingsTab'
import { AgentTab } from './AgentTab'
import { LibraryTab } from './LibraryTab'
import { ExtractTab } from './ExtractTab'
import './styles.css'

type TabId = 'settings' | 'library' | 'agent' | 'extract'

const TABS: { id: TabId; label: string }[] = [
  { id: 'settings', label: 'Settings' },
  { id: 'library', label: 'Library' },
  { id: 'agent', label: 'Agent' },
  { id: 'extract', label: 'Extract' },
]

export function MainWindow(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('settings')

  const handleClose = useCallback(() => {
    window.electronAPI.closeWindow()
  }, [])

  useEffect(() => {
    const handleDomNavigate = (event: Event) => {
      const nextTab = (event as CustomEvent<{ tab?: string }>).detail?.tab
      if (nextTab === 'settings' || nextTab === 'library' || nextTab === 'agent' || nextTab === 'extract') {
        setActiveTab(nextTab)
      }
    }

    const handleElectronNavigate = (detail: { tab?: string }) => {
      const nextTab = detail.tab
      if (nextTab === 'settings' || nextTab === 'library' || nextTab === 'agent' || nextTab === 'extract') {
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
        {activeTab === 'agent' && <AgentTab />}
        {activeTab === 'extract' && <ExtractTab />}
      </div>
    </div>
  )
}
