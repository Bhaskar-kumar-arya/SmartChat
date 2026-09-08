import { contextBridge, ipcRenderer } from 'electron'
import { createKernelApiBridge } from '../../packages/sdk/src/bridge'

let panelId = ''
// F1-06: `events.on()` calls made during panel module init (before `_init`
// supplies the real panelId) must not fire a subscribe with an empty panelId.
// Queue them and flush once `_init` runs.
const pendingSubscribes: Array<() => void> = []

function request<T = unknown>(type: string, payload?: unknown): Promise<T> {
  return ipcRenderer
    .invoke('kernel:panel:api', { panelId, type, payload })
    .then((res: { ok: boolean; payload?: T; error?: { code?: string; message?: string } }) => {
      if (!res.ok) {
        const err = new Error(res.error?.message ?? `Panel request '${type}' failed`)
        if (res.error?.code) {
          ;(err as unknown as { code: string }).code = res.error.code
        }
        throw err
      }
      return res.payload as T
    })
}

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

const bridge = createKernelApiBridge(request)

contextBridge.exposeInMainWorld('__smartchat', {
  _init(id: string, tokens: Record<string, string>) {
    panelId = id
    while (pendingSubscribes.length) {
      pendingSubscribes.shift()!()
    }
    applyTokens(tokens)
    try {
      window.dispatchEvent(new CustomEvent('smartchat:ready', { detail: { panelId, tokens } }))
    } catch (e) {}
  },

  api: {
    ...bridge,
    events: {
      on(event: string, handler: (payload: unknown) => void): () => void {
        let disposed = false
        const subscribe = (): void => {
          if (disposed) return
          ipcRenderer
            .invoke('kernel:panel:events:subscribe', { panelId, eventName: event })
            .catch((err: unknown) =>
              console.error(`[panel] event subscribe '${event}' failed:`, err)
            )
        }
        if (panelId) {
          subscribe()
        } else {
          pendingSubscribes.push(subscribe)
        }
        const listener = (_: unknown, msg: { event: string; payload: unknown }) => {
          if (msg && msg.event === event) {
            handler(msg.payload)
          }
        }
        ipcRenderer.on('smartchat:event', listener)
        return () => {
          disposed = true
          if (panelId) {
            ipcRenderer.send('kernel:panel:events:unsubscribe', { panelId, eventName: event })
          }
          ipcRenderer.removeListener('smartchat:event', listener)
        }
      }
    }
  }
})

window.addEventListener('unload', () => {
  if (panelId) {
    ipcRenderer.send('kernel:panel:closed', { panelId })
  }
})
