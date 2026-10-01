import { describe, it, expect, vi, beforeAll } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { registerAllIpc } from './ipcHarness'

vi.mock('../../services/ai/AIToolInitializer', () => ({
  AIToolInitializer: { initializeAll: vi.fn() }
}))

const MAIN_DIR = join(__dirname, '../..')
const PRELOAD_DIR = join(MAIN_DIR, '../preload')
const RENDERER_SERVICES = join(MAIN_DIR, '../renderer/src/services')

function strings(re: RegExp, text: string): string[] {
  return [...text.matchAll(re)].map(m => m[1])
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    if (name === 'tests') return []
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
  })
}

const preloadSrc = readFileSync(join(PRELOAD_DIR, 'index.ts'), 'utf8')
const preloadDts = readFileSync(join(PRELOAD_DIR, 'index.d.ts'), 'utf8')
const iApiSrc = readFileSync(join(RENDERER_SERVICES, 'IAPIService.ts'), 'utf8')
const indexSrc = readFileSync(join(MAIN_DIR, 'index.ts'), 'utf8')

// Literal channel names only: dynamic channels (`${channelId}-chunk`) are not checkable.
// Channels come from every preload script (index, panel-preload, overlay-preload).
const preloadFiles = readdirSync(PRELOAD_DIR).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
const readPreload = (files: string[]): string => files.map(f => readFileSync(join(PRELOAD_DIR, f), 'utf8')).join('\n')
const allPreloadSrc = readPreload(preloadFiles)
// overlay-preload listens to events sent by the renderer's <webview> host (not main), so it is
// excluded from the main-emitter check.
const mainFacingPreloadSrc = readPreload(preloadFiles.filter(f => f !== 'overlay-preload.ts'))
const preloadInvoke = strings(/ipcRenderer\s*\.invoke\(\s*'([^']+)'/g, allPreloadSrc)
const preloadSend = strings(/ipcRenderer\s*\.send\(\s*'([^']+)'/g, allPreloadSrc)
const preloadOn = strings(/ipcRenderer\s*\.on\(\s*'([^']+)'/g, mainFacingPreloadSrc)

const apiStart = preloadSrc.indexOf('const api = {')
const apiBody = preloadSrc.slice(apiStart, preloadSrc.indexOf('\n}\n', apiStart))
const preloadMethods = strings(/^ {2}(\w+): /gm, apiBody)
const dtsMethods = strings(/^ {6}(\w+)\??: /gm, preloadDts.slice(preloadDts.indexOf('api: {')))
const iApiMethods = strings(/^ {2}(\w+)\??[(:]/gm, iApiSrc)

// Everything in src/main (non-test) concatenated: used to find main -> renderer emitters.
const mainSources = walk(MAIN_DIR).map(f => readFileSync(f, 'utf8')).join('\n')

let registeredInvoke: string[] = []
let registeredSend: string[] = []

beforeAll(() => {
  const ipc = registerAllIpc()
  registeredInvoke = ipc.invokeChannels()
  // `ping` / `wa-skip-sync` are registered inline in main/index.ts (boot file, not registrable here).
  registeredSend = [...ipc.sendChannels(), ...strings(/ipcMain\.on\(\s*'([^']+)'/g, indexSrc)]
})

const missing = (have: string[], want: string[]): string[] =>
  [...new Set(have)].filter(c => !want.includes(c)).sort()

/**
 * Allow-lists pin the drift that exists today. Each entry names the unit that
 * removes it. They may only SHRINK: a stale entry (no longer drifting) fails
 * the test, forcing its removal, and a new drift fails because it is not listed.
 */

// preload invokes/sends a channel that no main handler registers
const PRELOAD_CALLS_UNHANDLED: Record<string, string> = {
  // M1 / B-APP-02: extension chat has no backend (decision D1: implement or delete).
  'extension:chat-history': 'C-04 (R-APP-05, B-APP-02, decision D1)',
  'extension:chat-send': 'C-04 (R-APP-05, B-APP-02, decision D1)',
  'extension:get-docs': 'C-04 (R-APP-05, B-APP-02, decision D1)'
}
// main registers an invoke/send channel that nothing in the preload calls
const MAIN_HANDLER_UNCALLED: Record<string, string> = {
  // Dead dev leftover registered in main/index.ts; nothing calls it.
  ping: 'C-04 (R-APP-05, dead handlers; deleted or documented)'
}
// preload listens on a main->renderer channel that no main source ever emits
const PRELOAD_LISTENS_NEVER_EMITTED: Record<string, string> = {
  // M2 / B-APP-02: preload listens, main never emits.
  'extension:chat-push': 'C-04 (R-APP-05, B-APP-02, decision D1)',
  'extension:focus': 'C-04 (R-APP-05, B-APP-02, decision D1)'
}
// main emits a channel the preload never subscribes to (renderer cannot receive it)
const MAIN_EMITS_UNLISTENED: Record<string, string> = {
  // M3 / B-APP-03: main emits, preload has no onToast / onWaDisconnected.
  toast: 'C-04 (R-APP-05, B-APP-03: add onToast wired to ToastContext)',
  'wa-disconnected': 'C-04 (R-APP-05, B-APP-03: add onWaDisconnected wired to App.tsx)'
}
// preload api method not declared in index.d.ts (Window['api'])
const PRELOAD_NOT_IN_DTS: Record<string, string> = {}
// index.d.ts method not implemented by the preload
const DTS_NOT_IN_PRELOAD: Record<string, string> = {}
// preload method missing from IAPIService
const PRELOAD_NOT_IN_IAPI: Record<string, string> = {
  // Dead renderer-side: IAPIService omits them, nothing in the renderer calls them.
  aiChat: 'C-04 (R-APP-05, dead channel ai-chat)',
  getChatContext: 'C-04 (R-APP-05, dead channel get-chat-context)',
  getAiAutoSave: 'C-04 (R-APP-05, dead channel ai-session-get-autosave)',
  duplicateExportedAiChat: 'C-04 (R-APP-05, dead channel duplicate-exported-ai-chat)',
  // Used via window.api directly in components/panels/*, bypassing the service layer.
  getPanelPreloadPath: 'C-03 (R-APP-04: IAPIService = RendererApi, panels routed through it)',
  notifyPanelClosed: 'C-03 (R-APP-04: IAPIService = RendererApi, panels routed through it)',
  onPanelClose: 'C-03 (R-APP-04: IAPIService = RendererApi, panels routed through it)',
  onPanelOpen: 'C-03 (R-APP-04: IAPIService = RendererApi, panels routed through it)'
}
// IAPIService method the preload does not implement
const IAPI_NOT_IN_PRELOAD: Record<string, string> = {}

function expectDrift(actual: string[], allowed: Record<string, string>): void {
  expect(actual).toEqual(Object.keys(allowed).sort())
}

describe('IPC contract drift (main handlers <-> preload <-> typings)', () => {
  it('sanity: the parsers found a realistic number of channels and methods', () => {
    expect(registeredInvoke.length).toBeGreaterThan(60)
    expect(registeredSend.length).toBeGreaterThan(5)
    expect(preloadInvoke.length).toBeGreaterThan(70)
    expect(preloadMethods.length).toBeGreaterThan(100)
    expect(dtsMethods.length).toBeGreaterThan(100)
    expect(iApiMethods.length).toBeGreaterThan(90)
  })

  it('every preload invoke/send channel has a registered main handler (modulo allow-list)', () => {
    const calls = [...preloadInvoke, ...preloadSend]
    expectDrift(missing(calls, [...registeredInvoke, ...registeredSend]), PRELOAD_CALLS_UNHANDLED)
  })

  it('every registered main handler is called by the preload (modulo allow-list)', () => {
    expectDrift(
      missing([...registeredInvoke, ...registeredSend], [...preloadInvoke, ...preloadSend]),
      MAIN_HANDLER_UNCALLED
    )
  })

  it('every preload event listener has a main emitter (modulo allow-list)', () => {
    const neverEmitted = [...new Set(preloadOn)].filter(c => !mainSources.includes(`'${c}'`)).sort()
    expectDrift(neverEmitted, PRELOAD_LISTENS_NEVER_EMITTED)
  })

  it('every main->renderer event is listened to by the preload (modulo allow-list)', () => {
    const emitted = strings(/\.send\(\s*'([^']+)'/g, mainSources)
    expectDrift(missing(emitted, preloadOn), MAIN_EMITS_UNLISTENED)
  })

  it('preload api methods match index.d.ts (modulo allow-list)', () => {
    expectDrift(missing(preloadMethods, dtsMethods), PRELOAD_NOT_IN_DTS)
    expectDrift(missing(dtsMethods, preloadMethods), DTS_NOT_IN_PRELOAD)
  })

  it('preload api methods match IAPIService (modulo allow-list)', () => {
    expectDrift(missing(preloadMethods, iApiMethods), PRELOAD_NOT_IN_IAPI)
    expectDrift(missing(iApiMethods, preloadMethods), IAPI_NOT_IN_PRELOAD)
  })
})
