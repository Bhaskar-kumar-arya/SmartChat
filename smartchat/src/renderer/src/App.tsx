import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { api } from './services/api.service'
import ChatLayout from './components/ChatLayout'

type AppState = 'initializing' | 'qr' | 'connected' | 'syncing' | 'ready'

export function App() {
  const [qr, setQr] = useState<string | null>(null)
  const [appState, setAppState] = useState<AppState>('initializing')
  const [syncProgress, setSyncProgress] = useState<number>(0)

  useEffect(() => {
    const unSubQr = api.onWaQr((newQr: string) => {
      setQr(newQr)
      setAppState('qr')
    })

    const unSubConn = api.onWaConnected(() => {
      setQr(null)
      setAppState('syncing')
      setSyncProgress(0)
    })

    const unSubLogout = api.onWaLoggedOut(() => {
      setQr(null)
      setAppState('initializing')
      setSyncProgress(0)
    })

    const unSubSyncPrg = api.onWaSyncProgress((progress: number) => {
      setSyncProgress(progress)
      if (appState !== 'syncing') {
        setAppState('syncing')
      }
    })

    const unSubSyncComp = api.onWaSyncComplete(() => {
      setSyncProgress(100)
      setAppState('ready')
    })

    return () => {
      unSubQr()
      unSubConn()
      unSubLogout()
      unSubSyncPrg()
      unSubSyncComp()
    }
  }, [appState])

  // ── Full-screen chat layout when ready ────────────────────────────
  if (appState === 'ready') {
    return <ChatLayout />
  }

  // ── Setup screens (QR, syncing, initializing) ─────────────────────
  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-icon">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        
        <h1 className="setup-title">SmartChat Setup</h1>
        
        <div className="setup-divider" />

        {appState === 'syncing' ? (
          <div className="sync-container">
            <div className="sync-badge">
              <p className="sync-badge-text">Connected to WhatsApp</p>
            </div>
            <div className="sync-progress-section">
              <div className="sync-progress-header">
                <span className="sync-label">Syncing messages...</span>
                <span className="sync-percent">{syncProgress}%</span>
              </div>
              <div className="sync-bar-track">
                <div 
                  className="sync-bar-fill"
                  style={{ width: `${Math.max(syncProgress, 2)}%` }}
                />
              </div>
              <p className="sync-subtitle">
                Importing your chat history into local storage...
              </p>
              <button
                onClick={() => window.api.skipSync()}
                className="sync-skip-btn"
              >
                Skip remaining sync →
              </button>
            </div>
          </div>
        ) : appState === 'qr' && qr ? (
          <div className="qr-container">
            <div className="qr-frame">
              <QRCodeSVG value={qr} size={256} className="qr-image" />
            </div>
            <div className="qr-instructions">
              <p className="qr-title">Scan QR Code</p>
              <p className="qr-subtitle">
                Open WhatsApp on your phone and link a device using this QR code.
              </p>
            </div>
          </div>
        ) : (
          <div className="init-container">
            <div className="init-spinner" />
            <p className="init-text">Initializing connection...</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
