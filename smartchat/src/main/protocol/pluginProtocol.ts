import * as Electron from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'


type SessionLike = Partial<Electron.Session> & {
  protocol?: {
    handle?: (scheme: string, handler: (request: Request) => Promise<Response>) => void
  }
}

let registeredSessions = new WeakSet<object>()

/**
 * `registerPluginProtocol` is called from both `app.whenReady()` (index.ts) and
 * `KernelBootstrapper.boot()` with the same extensions path. The `handle()` call
 * is deduped per-session by `registeredSessions`, but the app-level
 * `web-contents-created` listener is not — without this flag every call added
 * another permanent listener, tripping Node's `MaxListenersExceededWarning` once
 * a few webviews/windows had existed. (S13-02)
 */
let appWebContentsListenerRegistered = false

export function resetRegisteredSessions(): void {
  registeredSessions = new WeakSet<object>()
  appWebContentsListenerRegistered = false
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
        let resolvedPath = path.resolve(rootDir, '.' + relPath)

        // Security check: ensure path stays strictly within the plugin's directory
        if (resolvedPath !== rootDir && !resolvedPath.startsWith(allowedPrefix)) {
          console.warn(`[pluginProtocol] Access Denied for resolvedPath '${resolvedPath}' outside rootDir '${rootDir}'`)
          return new Response('Access Denied', { status: 403 })
        }

        // If path points to directory, check index.html
        if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
          resolvedPath = path.join(resolvedPath, 'index.html')
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
        console.warn(`[pluginProtocol] Error handling plugin URL '${request.url}':`, err)
        return new Response('File Not Found', { status: 404 })
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

  if (Electron.app && typeof Electron.app.on === 'function' && !appWebContentsListenerRegistered) {
    appWebContentsListenerRegistered = true
    Electron.app.on('web-contents-created', (_, contents) => {
      if (contents.getType() === 'webview' && contents.session) {
        registerPluginProtocolForSession(contents.session, extensionsPath)
      }
    })
  }
}
