import React, { useState, useCallback } from 'react'
import { SettingsTab } from './SettingsTab'
import { AgentTab } from './AgentTab'
import { LibraryTab } from './LibraryTab'
import './styles.css'

type TabId = 'settings' | 'library' | 'agent'

const TABS: { id: TabId; label: string }[] = [
  { id: 'settings', label: 'Settings' },
  { id: 'library', label: 'Library' },
  { id: 'agent', label: 'Agent' },
]

export function MainWindow(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('settings')

  const handleClose = useCallback(() => {
    window.electronAPI.closeWindow()
  }, [])

  return (
    <div className="main-window">
      <div className="main-window__header">
        <span className="main-window__title">Soulidity</span>
        <button className="main-window__close" onClick={handleClose} title="Close">
          ×
        </button>
      </div>

      <nav className="main-window__tabs">
        {TABS.map((tab) => (
          <button
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
      </div>
    </div>
  )
}
