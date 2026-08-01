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

ipcRenderer.on('smartchat:init', (_event, payload) => {
  if (payload && payload.tokens) {
    applyTokens(payload.tokens)
  }
  window.postMessage({ channel: 'smartchat:init', args: [payload] }, '*')
})

ipcRenderer.on('smartchat:send', (_event, payload) => {
  window.postMessage({ channel: 'smartchat:send', args: [payload] }, '*')
  window.postMessage({ channel: 'smartchat:receive', args: [payload] }, '*')
})

ipcRenderer.on('smartchat:receive', (_event, payload) => {
  window.postMessage({ channel: 'smartchat:send', args: [payload] }, '*')
  window.postMessage({ channel: 'smartchat:receive', args: [payload] }, '*')
})
