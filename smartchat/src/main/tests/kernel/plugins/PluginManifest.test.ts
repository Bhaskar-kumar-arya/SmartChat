import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import {
  validateManifest,
  ManifestValidationError,
  ApiVersionError
} from '../../../kernel/plugins/PluginManifest'
import { validateManifest as sdkValidateManifest } from '../../../../../packages/sdk/src/manifest'

const pluginsDir = resolve(__dirname, '../../../../../plugins')

function loadSampleManifests(): Array<{ dir: string; raw: unknown }> {
  return readdirSync(pluginsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(pluginsDir, d.name, 'manifest.json')))
    .map((d) => ({
      dir: d.name,
      raw: JSON.parse(readFileSync(join(pluginsDir, d.name, 'manifest.json'), 'utf8')) as unknown
    }))
}

const base = {
  id: 'com.test.plugin',
  name: 'Test Plugin',
  version: '1.0.0',
  apiVersion: '2',
  main: 'index.js',
  permissions: [] as string[],
  contributions: {}
}

describe('kernel validateManifest (characterization)', () => {
  it('finds the four sample plugin manifests', () => {
    expect(loadSampleManifests().map((m) => m.dir).sort()).toEqual([
      'codetantra-otp-relay-plugin',
      'declarative-modal-test-plugin',
      'test-all-features-plugin',
      'voice-transcriber-plugin'
    ])
  })

  it.each(loadSampleManifests().map((m) => [m.dir, m.raw] as const))(
    'accepts sample manifest %s',
    (_dir, raw) => {
      expect(() => validateManifest(raw)).not.toThrow()
    }
  )

  it('accepts a minimal valid manifest', () => {
    expect(validateManifest(base).id).toBe('com.test.plugin')
  })

  it.each([
    [null, 'Manifest is not a valid object'],
    ['str', 'Manifest is not a valid object'],
    [{ ...base, id: undefined }, 'Missing or invalid "id"'],
    [{ ...base, name: undefined }, 'Missing or invalid "name"'],
    [{ ...base, version: undefined }, 'Missing or invalid "version"'],
    [{ ...base, main: undefined }, 'Missing or invalid "main"'],
    [{ ...base, permissions: 'x' }, 'Permissions must be an array']
  ])('rejects %j with ManifestValidationError', (raw, message) => {
    expect(() => validateManifest(raw)).toThrow(ManifestValidationError)
    expect(() => validateManifest(raw)).toThrow(message)
  })

  it.each(['a/b', '../evil', '.hidden', 'a..b'])('rejects unsafe id %s', (id) => {
    expect(() => validateManifest({ ...base, id })).toThrow(/Invalid "id"/)
  })

  it.each(['../x.js', '/abs.js', '\\abs.js', 'a/../b.js'])('rejects unsafe main %s', (main) => {
    expect(() => validateManifest({ ...base, main })).toThrow(/Invalid "main"/)
  })

  it('throws ApiVersionError for an unsupported apiVersion', () => {
    expect(() => validateManifest({ ...base, apiVersion: '1' })).toThrow(ApiVersionError)
  })

  it('throws ManifestValidationError when apiVersion is missing', () => {
    expect(() => validateManifest({ ...base, apiVersion: undefined })).toThrow(ManifestValidationError)
  })

  it('requires a contributions object', () => {
    expect(() => validateManifest({ ...base, contributions: undefined })).toThrow(ManifestValidationError)
    expect(() => validateManifest({ ...base, contributions: [] })).toThrow(ManifestValidationError)
  })
})

// R-KRN-10: stricter rules (D10 unconsumed slots, panel containment, single SDK schema).
describe('kernel validateManifest (R-KRN-10 stricter rules)', () => {
  const UNUSED_SLOTS: Array<[string, unknown]> = [
    ['chatBadges', [{ id: 'b' }]],
    ['keyboardShortcuts', [{ id: 'k', defaultBinding: 'Ctrl+K', description: 'd' }]],
    ['statusBarItems', [{ id: 's', alignment: 'left' }]],
    ['chatFilters', [{ id: 'f', label: 'F' }]],
    ['chatSortStrategies', [{ id: 'o', label: 'O' }]],
    ['messageRenderers', [{ id: 'm', messageType: 't' }]]
  ]

  it.each(UNUSED_SLOTS)('rejects unconsumed slot %s with a clear error', (slot, value) => {
    const raw = { ...base, contributions: { [slot]: value } }
    expect(() => validateManifest(raw)).toThrow(ManifestValidationError)
    expect(() => validateManifest(raw)).toThrow(`Unsupported contribution slot "${slot}"`)
  })

  it('rejects a sidebar panel path that escapes the plugin directory', () => {
    const raw = { ...base, contributions: { sidebarPanels: [{ id: 's', title: 'S', panel: '../../etc/passwd' }] } }
    expect(() => validateManifest(raw)).toThrow(/Invalid "contributions.sidebarPanels\[0\].panel"/)
  })

  it('rejects an absolute settings page panel path', () => {
    const raw = { ...base, contributions: { settingsPages: [{ id: 's', title: 'S', panel: '/etc/passwd' }] } }
    expect(() => validateManifest(raw)).toThrow(/Invalid "contributions.settingsPages\[0\].panel"/)
  })

  it('rejects an unknown when operator', () => {
    const raw = {
      ...base,
      contributions: { chatActions: [{ id: 'a', label: 'A', when: { field: 'x', op: 'equals', value: 1 } }] }
    }
    expect(() => validateManifest(raw)).toThrow(/Invalid "contributions\.chatActions\[0\]\.when"/)
  })

  it('delegates to the single SDK validateManifest', () => {
    expect(validateManifest).toBe(sdkValidateManifest)
  })

  it('SDK validateManifest accepts the codetantra sample (G-01)', () => {
    const codetantra = loadSampleManifests().find((m) => m.dir === 'codetantra-otp-relay-plugin')
    expect(() => sdkValidateManifest(codetantra?.raw)).not.toThrow()
  })

  it.each(['declarative-modal-test-plugin', 'test-all-features-plugin', 'voice-transcriber-plugin'])(
    'SDK validateManifest accepts sample %s',
    (dir) => {
      const sample = loadSampleManifests().find((m) => m.dir === dir)
      expect(() => sdkValidateManifest(sample?.raw)).not.toThrow()
    }
  )
})
