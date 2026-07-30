import { useEffect, useRef } from 'react'

export interface PanelWebviewProps {
  panelId: string
  pluginId: string
  panelUrl: string
  visible: boolean
  title?: string
  className?: string
}

function extractThemeTokens(): Record<string, string> {
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

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const handleDomReady = () => {
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

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady)
    }
  }, [panelId])

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
      <webview
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
