import { useEffect, useState, useRef, useMemo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useAPI } from './context/APIContext'
import { ChatLayout } from './components/chat'
import { CheckCircle2, Loader2, Circle } from 'lucide-react'

type AppState = 'initializing' | 'qr' | 'connected' | 'syncing' | 'ready'

export function App() {
  const api = useAPI()
  const [qr, setQr] = useState<string | null>(null)
  const [appState, setAppState] = useState<AppState>('initializing')
  const [syncProgress, setSyncProgress] = useState<number>(0)
  const [syncStatus, setSyncStatus] = useState<string>('Initializing connection...')
  const [syncFullHistory, setSyncFullHistory] = useState<boolean>(false)
  const [syncType, setSyncType] = useState<number>(0)
  const [isRegeneratingQr, setIsRegeneratingQr] = useState<boolean>(false)

  const appStateRef = useRef<AppState>(appState)

  useEffect(() => {
    appStateRef.current = appState
  }, [appState])

  // 1. Initial configuration load
  useEffect(() => {
    api.getSyncFullHistory().then((full: boolean) => {
      setSyncFullHistory(full)
    }).catch(err => {
      console.error('Failed to get sync full history preference:', err)
    })
  }, [])

  // 2. Auth & Sync listeners
  useEffect(() => {
    const unSubQr = api.onWaQr((newQr: string) => {
      setQr(newQr)
      setIsRegeneratingQr(false)
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
      setSyncType(0)
      setSyncStatus('Initializing connection...')
    })

    const unSubSyncPrg = api.onWaSyncProgress((data) => {
      setSyncProgress(data.progress)
      setSyncType(data.syncType)
      setSyncFullHistory(data.syncFullHistory)
      if (appStateRef.current !== 'syncing') {
        setAppState('syncing')
      }
    })

    const unSubSyncStatus = api.onWaSyncStatus((status: string) => {
      setSyncStatus(status)
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
      unSubSyncStatus()
      unSubSyncComp()
    }
  }, [])

  const handleSetSyncFullHistory = async (full: boolean) => {
    if (syncFullHistory === full) return
    setIsRegeneratingQr(true)
    setQr(null)
    setSyncFullHistory(full)
    await api.setSyncFullHistory(full)
  }

  // Define steps (placed before any early returns to satisfy React Hook rules)
  const steps = useMemo(() => [
    {
      id: 1,
      title: 'Connection Handshake',
      description: 'Establishing secure tunnel with WhatsApp servers',
      status: appState === 'syncing' ? 'completed' : 'active'
    },
    {
      id: 2,
      title: 'Directory Ingestion',
      description: 'Loading contacts, channels, and active chat lists',
      status: appState !== 'syncing' ? 'pending' : (syncType === 0 ? 'active' : 'completed')
    },
    {
      id: 3,
      title: 'Message History Sync',
      description: syncFullHistory
        ? (syncType === 2 ? 'Downloading deep historical message history' : 'Downloading recent messages')
        : 'Downloading recent message backlog',
      status: appState !== 'syncing' || syncType === 0
        ? 'pending'
        : (syncType === 3 || syncType === 2 ? 'active' : 'completed')
    },
    {
      id: 4,
      title: 'Hydrating Group Metadata',
      description: 'Resolving group details, settings, and participant roles',
      status: appState !== 'syncing' || syncType < 6
        ? 'pending'
        : (syncType === 6 && syncProgress < 100 ? 'active' : 'completed')
    }
  ], [appState, syncType, syncFullHistory, syncProgress])

  // ── Full-screen chat layout when ready ────────────────────────────
  if (appState === 'ready') {
    return <ChatLayout />
  }

  const radius = 60
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (syncProgress / 100) * circumference

  return (
    <div className="setup-screen">
      {/* Background glow blobs */}
      <div className="bg-glow-blob blob-1" />
      <div className="bg-glow-blob blob-2" />

      <div className="setup-card">
        <div className="setup-header">
          <div className="setup-icon">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div className="setup-header-text">
            <h1 className="setup-title">SmartChat</h1>
            <p className="setup-subtitle">WhatsApp Integration Setup</p>
          </div>
        </div>

        <div className="setup-divider" />

        {appState === 'syncing' ? (
          <div className="sync-layout-grid">
            <div className="sync-left-panel">
              <div className="progress-circle-container">
                <svg className="progress-circle" width="160" height="160" viewBox="0 0 160 160">
                  <defs>
                    <linearGradient id="progress-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="var(--wa-primary)" />
                      <stop offset="100%" stopColor="var(--wa-primary-dark)" />
                    </linearGradient>
                    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="6" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <circle
                    className="progress-circle-bg"
                    cx="80"
                    cy="80"
                    r={radius}
                    strokeWidth="8"
                  />
                  <circle
                    className="progress-circle-bar"
                    cx="80"
                    cy="80"
                    r={radius}
                    strokeWidth="8"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    filter="url(#glow)"
                  />
                </svg>
                <div className="progress-circle-text">
                  <span className="percent-val">{syncProgress}%</span>
                  <span className="percent-lbl">Syncing</span>
                </div>
              </div>

              <div className="sync-logs-ticker">
                <div className="logs-header">
                  <span className="logs-title">System Status</span>
                  <span className="logs-pulse" />
                </div>
                <div className="logs-content">
                  <div className="log-line">{syncStatus}</div>
                </div>
              </div>
            </div>

            <div className="sync-right-panel">
              <div className="steps-container">
                {steps.map((step) => (
                  <div key={step.id} className={`step-item ${step.status}`}>
                    <div className="step-icon-wrapper">
                      {step.status === 'completed' ? (
                        <CheckCircle2 />
                      ) : step.status === 'active' ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Circle />
                      )}
                    </div>
                    <div className="step-info">
                      <p className="step-title">{step.title}</p>
                      <p className="step-desc">{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="sync-controls-panel">
                <button
                  onClick={() => api.skipSync()}
                  className="sync-skip-btn"
                >
                  Skip remaining sync →
                </button>
                <p className="skip-hint">
                  Skip sync to start chatting instantly. History ingestion will continue in the background.
                </p>
              </div>
            </div>
          </div>
        ) : appState === 'qr' ? (
          <div className="qr-container-split">
            <div className="qr-left">
              <div className="qr-frame">
                {isRegeneratingQr || !qr ? (
                  <div className="qr-loading-placeholder">
                    <Loader2 className="w-10 h-10 animate-spin" />
                    <p className="qr-loading-text">Generating new QR code...</p>
                  </div>
                ) : (
                  <QRCodeSVG value={qr} size={256} className="qr-image" />
                )}
              </div>
              <div className="qr-instructions">
                <p className="qr-title">Scan QR Code</p>
                <p className="qr-subtitle">
                  Open WhatsApp on your phone &gt; Settings &gt; Linked Devices &gt; Link a Device.
                </p>
              </div>
            </div>

            <div className="qr-right">
              <div className="sync-mode-selector">
                <h3 className="selector-section-title">Select Sync Preference</h3>
                <p className="selector-section-desc">
                  Choose how much historical data you want to retrieve before starting the app.
                </p>

                <div className={`sync-mode-options ${isRegeneratingQr ? 'disabled' : ''}`}>
                  <div
                    className={`sync-mode-option ${!syncFullHistory ? 'active' : ''}`}
                    onClick={() => !isRegeneratingQr && handleSetSyncFullHistory(false)}
                  >
                    <div className="option-radio-indicator" />
                    <div className="option-text-group">
                      <span className="option-title">Recent Messages Only</span>
                      <span className="option-desc">Loads recent chat history (~1 month). Recommended for faster setup.</span>
                    </div>
                  </div>

                  <div
                    className={`sync-mode-option ${syncFullHistory ? 'active' : ''}`}
                    onClick={() => !isRegeneratingQr && handleSetSyncFullHistory(true)}
                  >
                    <div className="option-radio-indicator" />
                    <div className="option-text-group">
                      <span className="option-title">Full Message History</span>
                      <span className="option-desc">Deep sync, downloads complete chat history. Takes longer to complete.</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="init-container">
            <div className="init-spinner-wrapper">
              <div className="init-spinner" />
              <div className="init-spinner-glow" />
            </div>
            <p className="init-text">{syncStatus}</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
