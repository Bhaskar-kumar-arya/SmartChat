import { join } from 'path'
import { pathToFileURL } from 'url'

/**
 * Whether a <webview> `preload` param is one of the app's own bundled preloads.
 * The renderer passes `preload` as a file:// URL (see getPanelPreloadPath), so
 * both the URL and the raw filesystem path forms must be accepted.
 */
export function isAllowedGuestPreload(preload: string, preloadDir: string): boolean {
  return ['panel-preload.js', 'overlay-preload.js'].some((name) => {
    const file = join(preloadDir, name)
    return preload === file || preload === pathToFileURL(file).href
  })
}
