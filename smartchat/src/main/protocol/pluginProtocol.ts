import * as Electron from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

type SessionLike = Partial<Electron.Session> & {
  protocol?: {
    handle?: (scheme: string, handler: (request: Request) => Promise<Response>) => void
  }
}

let registeredSessions = new WeakSet<object>()

export function resetRegisteredSessions(): void {
  registeredSessions = new WeakSet<object>()
}

export function registerPluginProtocolForSession(targetSession: SessionLike, extensionsPath: string): void {
  if (!targetSession || registeredSessions.has(targetSession)) {
    return
  }

  const handleFn = targetSession.protocol?.handle || Electron.protocol?.handle
  if (typeof handleFn !== 'function') {
    return
  }

  try {
    registeredSessions.add(targetSession)
    handleFn.call(targetSession.protocol || Electron.protocol, 'plugin', async (request) => {
      try {
        const url = new URL(request.url)
        const pluginId = url.hostname
        if (!pluginId) {
          console.warn('[pluginProtocol] Invalid plugin ID (missing hostname)')
          return new Response('Invalid plugin ID', { status: 400 })
        }

        const relPath = decodeURIComponent(url.pathname)
        const rootDir = path.resolve(extensionsPath, pluginId)
        const allowedPrefix = rootDir.endsWith(path.sep) ? rootDir : rootDir + path.sep
        const resolvedPath = path.resolve(rootDir, '.' + relPath)

        // Security check: ensure path stays strictly within the plugin's directory
        if (resolvedPath !== rootDir && !resolvedPath.startsWith(allowedPrefix)) {
          console.warn(`[pluginProtocol] Access Denied for resolvedPath '${resolvedPath}' outside rootDir '${rootDir}'`)
          return new Response('Access Denied', { status: 403 })
        }

        const res = await Electron.net.fetch(pathToFileURL(resolvedPath).href)
        const headers = new Headers(res.headers)
        headers.set('Access-Control-Allow-Origin', '*')

        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers
        })
      } catch (err) {
        console.error('[pluginProtocol] Error handling plugin URL:', err)
        return new Response('Invalid plugin URL', { status: 400 })
      }
    })
  } catch (err) {
    console.error('[pluginProtocol] Failed to register plugin protocol handler on session:', err)
  }
}

/**
 * Registers the `plugin://` custom protocol handler with Electron for defaultSession and future partition sessions.
 */
export function registerPluginProtocol(extensionsPath: string): void {
  const electronSession = Electron.session
  const defaultSes = electronSession ? electronSession.defaultSession : null
  if (defaultSes) {
    registerPluginProtocolForSession(defaultSes, extensionsPath)
  } else if (Electron.protocol && typeof Electron.protocol.handle === 'function') {
    registerPluginProtocolForSession({ protocol: Electron.protocol }, extensionsPath)
  }

  if (Electron.app && typeof Electron.app.on === 'function') {
    Electron.app.on('web-contents-created', (_, contents) => {
      if (contents.getType() === 'webview' && contents.session) {
        registerPluginProtocolForSession(contents.session, extensionsPath)
      }
    })
  }
}
