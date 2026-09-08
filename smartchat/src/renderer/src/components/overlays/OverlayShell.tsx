import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useAPI } from '../../context/APIContext'
import { WebviewOverlayRequest } from '../../../../main/kernel/ui/IOverlayHost'

export interface OverlayShellProps {
  request: WebviewOverlayRequest
  onClose: (overlayId: string) => void
}

interface WebviewIpcMessageEvent extends Event {
  channel: string
  args?: unknown[]
}

interface WebviewDidFailLoadEvent extends Event {
  errorCode: number
  errorDescription: string
  validatedURL: string
}

export function OverlayShell({ request, onClose }: OverlayShellProps) {
  const api = useAPI()
  const webviewRef = useRef<HTMLWebViewElement | null>(null)

  const { overlayId, pluginId, panel, title, context } = request
  // F10-13: clamp plugin-supplied dimensions to a sane range (container already
  // caps the visible size at 90vw/90vh).
  const clampDim = (v: unknown, fallback: number): number => {
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n) || n <= 0) return fallback
    return Math.min(Math.max(Math.round(n), 200), 4000)
  }
  const width = clampDim(request.width, 480)
  const height = clampDim(request.height, 360)
  const webviewSrc = `plugin://${pluginId}/${panel.replace(/^\//, '')}`
  const partition = `persist:plugin-${pluginId}`

  // F10-03: surface a load failure instead of leaving a blank shell.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const handleDomReady = () => {
    const webview = webviewRef.current as (HTMLWebViewElement & { send?: (channel: string, data: unknown) => void }) | null
    if (!webview) return

    setLoadError(null)

    const style = getComputedStyle(document.documentElement)
    const tokens: Record<string, string> = {}
    for (let i = 0; i < style.length; i++) {
      const prop = style[i]
      if (prop.startsWith('--wa-')) {
        tokens[prop] = style.getPropertyValue(prop).trim()
      }
    }

    if (typeof webview.send === 'function') {
      webview.send('smartchat:init', {
        tokens,
        context: context || {},
        overlayId
      })
    }
  }

  useEffect(() => {
    const webview = webviewRef.current as unknown as HTMLElement | null
    if (!webview) return

    const handleIpcMessage = (e: Event) => {
      const evt = e as WebviewIpcMessageEvent
      const channel = evt.channel
      const args = evt.args || []

      if (channel === 'smartchat:submit') {
        const data = args[0]
        api.overlaySubmit?.(overlayId, data)
        onClose(overlayId)
      } else if (channel === 'smartchat:event') {
        const payload = (args[0] as { event?: string; data?: unknown }) || {}
        if (payload.event) {
          api.overlayEvent?.(overlayId, payload.event, payload.data)
        }
      } else if (channel === 'smartchat:dismiss') {
        api.overlayDismiss?.(overlayId)
        onClose(overlayId)
      }
    }

    const handleDidFailLoad = (e: Event) => {
      const evt = e as WebviewDidFailLoadEvent
      // errorCode -3 is ABORTED (e.g. a superseded in-page load) — not a real failure.
      if (evt.errorCode === -3) return
      console.error(`[OverlayShell] webview did-fail-load for overlayId '${overlayId}':`, evt.errorCode, evt.errorDescription, evt.validatedURL)
      setLoadError(evt.errorDescription || `Failed to load (${evt.errorCode})`)
    }

    if (typeof webview.addEventListener === 'function') {
      webview.addEventListener('dom-ready', handleDomReady)
      webview.addEventListener('ipc-message', handleIpcMessage)
      webview.addEventListener('did-fail-load', handleDidFailLoad)
    }

    return () => {
      if (typeof webview.removeEventListener === 'function') {
        webview.removeEventListener('dom-ready', handleDomReady)
        webview.removeEventListener('ipc-message', handleIpcMessage)
        webview.removeEventListener('did-fail-load', handleDidFailLoad)
      }
    }
  }, [api, overlayId, context, onClose, reloadKey])

  useEffect(() => {
    if (!api.onOverlaySend) return

    const unsubscribe = api.onOverlaySend((payload) => {
      if (payload.overlayId === overlayId && webviewRef.current) {
        const webview = webviewRef.current as any
        if (typeof webview.send === 'function') {
          const payloadData = {
            event: payload.event,
            data: payload.data
          }
          // F10-02: host→guest inbound data goes ONLY on `smartchat:receive`.
          // `smartchat:send` stays guest→host so a guest can't confuse the two.
          webview.send('smartchat:receive', payloadData)
        }
      }
    })
    return unsubscribe
  }, [api, overlayId])

  const handleDismiss = () => {
    api.overlayDismiss?.(overlayId)
    onClose(overlayId)
  }

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDismiss()
      }}
      data-testid={`webview-overlay-backdrop-${overlayId}`}
    >
      <div
        className="tier2-overlay-container"
        style={{
          background: 'var(--wa-bg-secondary)',
          borderRadius: '12px',
          border: '1px solid var(--wa-divider)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxWidth: '90vw',
          maxHeight: '90vh'
        }}
        data-testid={`webview-overlay-shell-${overlayId}`}
      >
        <div
          className="tier2-overlay-header"
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--wa-divider)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--wa-bg-main)'
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--wa-text-primary)'
            }}
          >
            {title || pluginId}
          </h3>
          <button
            type="button"
            className="close-btn"
            onClick={handleDismiss}
            aria-label="Close"
            data-testid={`webview-overlay-close-${overlayId}`}
          >
            <X style={{ width: '18px', height: '18px' }} />
          </button>
        </div>

        <div
          className="tier2-overlay-body"
          style={{
            width,
            height,
            maxWidth: '100%',
            maxHeight: '100%',
            overflow: 'hidden'
          }}
        >
          {loadError ? (
            <div
              className="tier2-overlay-error"
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                padding: '24px',
                textAlign: 'center',
                color: 'var(--wa-text-secondary)'
              }}
              data-testid={`webview-overlay-error-${overlayId}`}
            >
              <p style={{ margin: 0, fontSize: '13px' }}>
                This panel failed to load.
                <br />
                <span style={{ opacity: 0.7 }}>{loadError}</span>
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="tier1-btn tier1-btn-secondary"
                  onClick={handleDismiss}
                  data-testid={`webview-overlay-error-close-${overlayId}`}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="tier1-btn tier1-btn-primary"
                  onClick={() => {
                    setLoadError(null)
                    setReloadKey((k) => k + 1)
                  }}
                  data-testid={`webview-overlay-error-retry-${overlayId}`}
                >
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* @ts-ignore Electron webview tag */}
              <webview
                key={reloadKey}
                ref={webviewRef}
                src={webviewSrc}
                partition={partition}
                preload={api.getOverlayPreloadPath?.()}
                webpreferences="contextIsolation=yes, nodeIntegration=no, nodeIntegrationInSubFrames=no, sandbox=yes, webSecurity=yes"
                style={{ width: '100%', height: '100%', border: 'none' }}
                data-testid={`webview-element-${overlayId}`}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
