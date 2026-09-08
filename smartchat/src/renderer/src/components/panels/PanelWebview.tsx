import { useEffect, useRef, useState } from 'react'

export interface PanelWebviewProps {
  panelId: string
  pluginId: string
  panelUrl: string
  visible: boolean
  title?: string
  className?: string
}

// The `--wa-*` token set is a fixed, app-level list that only changes on a theme
// switch (which the app does not currently support). Scanning every stylesheet
// rule on every panel dom-ready is an O(rules×props) hitch (F9-11), so cache the
// first successful scan for the session.
let cachedThemeTokens: Record<string, string> | null = null

function extractThemeTokens(): Record<string, string> {
  if (cachedThemeTokens) return cachedThemeTokens
  const tokens: Record<string, string> = {}
  const computedStyle = getComputedStyle(document.documentElement)

  try {
    for (let i = 0; i < document.styleSheets.length; i++) {
      const sheet = document.styleSheets[i]
      try {
        const rules = sheet.cssRules || sheet.rules
        if (!rules) continue
        for (let j = 0; j < rules.length; j++) {
          const rule = rules[j]
          if (rule instanceof CSSStyleRule && rule.style) {
            for (let k = 0; k < rule.style.length; k++) {
              const propName = rule.style[k]
              if (propName && propName.startsWith('--wa-') && !(propName in tokens)) {
                const val = computedStyle.getPropertyValue(propName).trim()
                if (val) {
                  tokens[propName] = val
                }
              }
            }
          }
        }
      } catch {
        // Ignore cross-origin stylesheet access errors if any
      }
    }
  } catch {
    // Ignore styleSheets access errors if any
  }

  if (Object.keys(tokens).length > 0) cachedThemeTokens = tokens
  return tokens
}



export function PanelWebview({
  panelId,
  pluginId,
  panelUrl,
  visible,
  className = ''
}: PanelWebviewProps) {
  const webviewRef = useRef<HTMLWebViewElement | null>(null)
  const preloadPath = window.api ? window.api.getPanelPreloadPath() : ''
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const handleStartLoad = () => setLoadError(null)
    const handleFailLoad = (e: Event) => {
      const ev = e as unknown as { errorCode?: number; isMainFrame?: boolean; validatedURL?: string }
      // -3 == ERR_ABORTED (navigation superseded / cancelled) — not a real failure.
      if (ev.errorCode === -3) return
      if (ev.isMainFrame === false) return
      setLoadError(`This panel failed to load (${ev.errorCode ?? 'unknown error'}).`)
    }

    const handleDomReady = () => {
      setLoadError(null)
      const tokens = extractThemeTokens()
      const initCode = `
        if (window.__smartchat && typeof window.__smartchat._init === 'function') {
          window.__smartchat._init(${JSON.stringify(panelId)}, ${JSON.stringify(tokens)});
        }
      `
      const wv = webview as unknown as { executeJavaScript: (code: string) => Promise<unknown> }
      wv.executeJavaScript(initCode).catch((err: unknown) => {
        console.error(`[PanelWebview] Failed to initialize panel ${panelId}:`, err)
      })

    }

    webview.addEventListener('dom-ready', handleDomReady)
    webview.addEventListener('did-start-loading', handleStartLoad)
    webview.addEventListener('did-fail-load', handleFailLoad as EventListener)

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady)
      webview.removeEventListener('did-start-loading', handleStartLoad)
      webview.removeEventListener('did-fail-load', handleFailLoad as EventListener)
    }
  }, [panelId, reloadNonce])

  useEffect(() => {
    return () => {
      if (window.api && typeof window.api.notifyPanelClosed === 'function') {
        window.api.notifyPanelClosed(panelId)
      }
    }
  }, [panelId])

  return (
    <div
      className={`panel-webview-container ${className}`}
      style={{
        display: visible ? 'flex' : 'none',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {loadError && (
        <div
          className="panel-webview-error"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            padding: '24px',
            textAlign: 'center',
            color: 'var(--wa-text-primary)',
            background: 'var(--wa-bg-deep)',
            zIndex: 1
          }}
        >
          <div style={{ fontSize: '40px' }}>⚠️</div>
          <p style={{ color: 'var(--wa-text-secondary)', fontSize: '14px' }}>{loadError}</p>
          <button
            className="panel-webview-retry-btn"
            onClick={() => {
              setLoadError(null)
              setReloadNonce((n) => n + 1)
            }}
          >
            Retry
          </button>
        </div>
      )}
      <webview
        key={reloadNonce}
        ref={webviewRef}
        src={panelUrl}
        preload={preloadPath}
        partition={`persist:plugin-${pluginId}`}
        style={{
          width: '100%',
          height: '100%',
          border: 'none'
        }}
      />
    </div>
  )
}
