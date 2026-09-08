import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('__smartchat', {
  submit: (data: unknown) => ipcRenderer.sendToHost('smartchat:submit', data),
  emit: (event: string, data: unknown) => ipcRenderer.sendToHost('smartchat:event', { event, data }),
  dismiss: () => ipcRenderer.sendToHost('smartchat:dismiss')
})

function applyTokens(tokens: Record<string, string>): void {
  if (!tokens || typeof tokens !== 'object') return
  const vars = Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')

  const inject = () => {
    const existing = document.getElementById('smartchat-theme-tokens')
    if (existing) {
      existing.textContent = `:root {\n${vars}\n}`
    } else {
      const style = document.createElement('style')
      style.id = 'smartchat-theme-tokens'
      style.textContent = `:root {\n${vars}\n}`
      if (document.head) {
        document.head.appendChild(style)
      } else {
        document.documentElement.appendChild(style)
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject)
  } else {
    inject()
  }
}

// F1-03: relay IPC payloads to the guest page on its OWN origin, not '*', so a
// guest that navigates to / embeds a third-party origin never receives overlay
// payloads. Keep `send` and `receive` as distinct one-directional channels
// instead of cross-posting each payload under both names.
function relayToGuest(channel: string, payload: unknown): void {
  // Opaque origins (file://, data:) serialize to the string "null", which is not
  // a valid postMessage targetOrigin — fall back to '*' only in that case.
  const origin = window.location.origin
  const targetOrigin = origin && origin !== 'null' ? origin : '*'
  window.postMessage({ channel, args: [payload] }, targetOrigin)
}

ipcRenderer.on('smartchat:init', (_event, payload) => {
  if (payload && payload.tokens) {
    applyTokens(payload.tokens)
  }
  relayToGuest('smartchat:init', payload)
})

ipcRenderer.on('smartchat:send', (_event, payload) => {
  relayToGuest('smartchat:send', payload)
})

ipcRenderer.on('smartchat:receive', (_event, payload) => {
  relayToGuest('smartchat:receive', payload)
})
