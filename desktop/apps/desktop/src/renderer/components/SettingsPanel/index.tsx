import React, { useState, useEffect, useCallback } from 'react'
import { useCliStatus } from '../../hooks/useCliStatus'
import './styles.css'

interface AgentKeypairInfo {
  address: string
  publicKey: string
  createdAt: number
}

export function SettingsPanel(): React.JSX.Element {
  const [keypair, setKeypair] = useState<AgentKeypairInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const { status: cliStatus } = useCliStatus()

  useEffect(() => {
    window.electronAPI.loadAgentKeypair().then((kp) => {
      if (kp) setKeypair(kp as AgentKeypairInfo)
    })
  }, [])

  const handleCopyAddress = useCallback(async () => {
    if (!keypair?.address) return
    await navigator.clipboard.writeText(keypair.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [keypair])

  const handleClose = useCallback(() => {
    window.electronAPI.closeWindow()
  }, [])

  const truncateAddress = (addr: string): string => {
    if (addr.length <= 16) return addr
    return `${addr.slice(0, 10)}...${addr.slice(-6)}`
  }

  return (
    <div className="settings-panel">
      <div className="settings-panel__header">
        <span className="settings-panel__title">Settings</span>
        <button className="settings-panel__close" onClick={handleClose} title="Close">
          ×
        </button>
      </div>

      <div className="settings-panel__body">
        <section className="settings-section">
          <h3 className="settings-section__title">Agent Wallet</h3>

          <div className="settings-field">
            <span className="settings-field__label">Sui Address</span>
            <div className="settings-field__input-group">
              <input
                type="text"
                className="settings-field__input"
                value={keypair ? truncateAddress(keypair.address) : 'Generating...'}
                readOnly
                title={keypair?.address}
              />
              <button
                className="settings-field__toggle"
                onClick={handleCopyAddress}
                title={copied ? 'Copied!' : 'Copy address'}
                disabled={!keypair}
              >
                {copied ? '\u2713' : '\u2398'}
              </button>
            </div>
          </div>

          {keypair && (
            <div className="settings-field">
              <span className="settings-field__label">Created</span>
              <input
                type="text"
                className="settings-field__input"
                value={new Date(keypair.createdAt).toLocaleDateString()}
                readOnly
              />
            </div>
          )}
        </section>

        <section className="settings-section">
          <h3 className="settings-section__title">Agent Monitor</h3>

          <div className="settings-field">
            <span className="settings-field__label">CLI Status</span>
            <input
              type="text"
              className="settings-field__input"
              value={cliStatus}
              readOnly
            />
          </div>
        </section>
      </div>
    </div>
  )
}
