import { describe, it, expect } from 'vitest'
import { validateManifest, ManifestValidationError, ApiVersionError, PluginManifest } from '../src/manifest'

describe('validateManifest', () => {
  const validV2Manifest: PluginManifest = {
    id: 'com.example.test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    apiVersion: '2',
    main: 'index.js',
    permissions: ['chats:read'],
    contributions: {
      chatActions: [
        { id: 'test-action', label: 'Test Action' }
      ]
    }
  }

  it('should accept a valid v2 manifest', () => {
    const validated = validateManifest(validV2Manifest)
    expect(validated).toEqual(validV2Manifest)
  })

  it('should throw ManifestValidationError for null or non-object', () => {
    expect(() => validateManifest(null)).toThrow(ManifestValidationError)
    expect(() => validateManifest('not an object')).toThrow(ManifestValidationError)
  })

  it('should throw ManifestValidationError for missing fields', () => {
    const missingId = { ...validV2Manifest, id: undefined }
    expect(() => validateManifest(missingId)).toThrow(ManifestValidationError)
  })

  it('should throw ManifestValidationError when contributions is missing (v1 manifest)', () => {
    const v1Manifest = {
      id: 'com.example.v1',
      name: 'V1 Plugin',
      version: '1.0.0',
      apiVersion: '1',
      main: 'index.js',
      permissions: []
    }
    expect(() => validateManifest(v1Manifest)).toThrow(ManifestValidationError)
  })

  it('should reject an id that is not a safe path segment (P2-S12-04)', () => {
    expect(() => validateManifest({ ...validV2Manifest, id: 'a/b' })).toThrow(ManifestValidationError)
    expect(() => validateManifest({ ...validV2Manifest, id: '../evil' })).toThrow(ManifestValidationError)
    expect(() => validateManifest({ ...validV2Manifest, id: '.hidden' })).toThrow(ManifestValidationError)
  })

  it('should reject a "main" that escapes the plugin directory (P2-S12-04)', () => {
    expect(() => validateManifest({ ...validV2Manifest, main: '../../../../etc/x.js' })).toThrow(ManifestValidationError)
    expect(() => validateManifest({ ...validV2Manifest, main: '/abs/path.js' })).toThrow(ManifestValidationError)
    expect(() => validateManifest({ ...validV2Manifest, main: 'C:\\x.js' })).toThrow(ManifestValidationError)
    expect(validateManifest({ ...validV2Manifest, main: 'dist/index.js' }).main).toBe('dist/index.js')
  })

  it('should throw ApiVersionError when apiVersion is not "2"', () => {
    const wrongVersion = {
      ...validV2Manifest,
      apiVersion: '3'
    }
    expect(() => validateManifest(wrongVersion)).toThrow(ApiVersionError)
  })

  describe('R-KRN-10 stricter rules', () => {
    const slots: Array<[string, unknown]> = [
      ['chatBadges', [{ id: 'b' }]],
      ['keyboardShortcuts', [{ id: 'k', defaultBinding: 'Ctrl+K', description: 'd' }]],
      ['statusBarItems', [{ id: 's', alignment: 'left' }]],
      ['chatFilters', [{ id: 'f', label: 'F' }]],
      ['chatSortStrategies', [{ id: 'o', label: 'O' }]],
      ['messageRenderers', [{ id: 'm', messageType: 't' }]]
    ]

    it.fails.each(slots)('rejects the unconsumed slot %s', (slot, value) => {
      expect(() => validateManifest({ ...validV2Manifest, contributions: { [slot]: value } })).toThrow(
        `Unsupported contribution slot "${slot}"`
      )
    })

    it.fails('rejects a panel path that escapes the plugin directory', () => {
      const raw = { ...validV2Manifest, contributions: { sidebarPanels: [{ id: 's', title: 'S', panel: '../x.html' }] } }
      expect(() => validateManifest(raw)).toThrow(/Invalid "contributions.sidebarPanels\[0\].panel"/)
    })

    it('accepts empty arrays for unconsumed slots and nested panel paths', () => {
      const raw = {
        ...validV2Manifest,
        contributions: { chatBadges: [], sidebarPanels: [{ id: 's', title: 'S', panel: 'panels/a.html' }] }
      }
      expect(() => validateManifest(raw)).not.toThrow()
    })
  })
})
