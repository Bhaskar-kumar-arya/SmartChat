import { useEffect, useRef } from 'react'
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

  const { overlayId, pluginId, panel, title, width = 480, height = 360, context } = request
  const webviewSrc = `plugin://${pluginId}/${panel.replace(/^\//, '')}`
  const partition = `persist:plugin-${pluginId}`

  const handleDomReady = () => {
    const webview = webviewRef.current as (HTMLWebViewElement & { send?: (channel: string, data: unknown) => void }) | null
    if (!webview) return

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
      console.error(`[OverlayShell] webview did-fail-load for overlayId '${overlayId}':`, evt.errorCode, evt.errorDescription, evt.validatedURL)
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
  }, [api, overlayId, context, onClose])

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
          webview.send('smartchat:receive', payloadData)
          webview.send('smartchat:send', payloadData)
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
          {/* @ts-ignore Electron webview tag */}
          <webview
            ref={webviewRef}
            src={webviewSrc}
            partition={partition}
            preload={api.getOverlayPreloadPath?.()}
            webpreferences="allowrunninginsecurecontent=yes, contextIsolation=yes"
            style={{ width: '100%', height: '100%', border: 'none' }}
            data-testid={`webview-element-${overlayId}`}
          />
        </div>
      </div>
    </div>
  )
}
