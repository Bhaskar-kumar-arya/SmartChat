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

  it('should throw ApiVersionError when apiVersion is not "2"', () => {
    const wrongVersion = {
      ...validV2Manifest,
      apiVersion: '3'
    }
    expect(() => validateManifest(wrongVersion)).toThrow(ApiVersionError)
  })
})
