import { describe, it, expect } from 'vitest'
import { validateManifest, ManifestValidationError } from '../../../../../packages/sdk/src/manifest'

describe('Manifest validation with when condition', () => {
  const baseManifest = {
    id: 'com.test.plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    apiVersion: '2',
    main: 'index.js',
    permissions: [],
    contributions: {}
  }

  it('validates manifest with valid leaf when condition in chatActions', () => {
    const raw = {
      ...baseManifest,
      contributions: {
        chatActions: [
          {
            id: 'action-1',
            label: 'Action 1',
            when: { field: 'chat.type', op: 'eq', value: 'GROUP' }
          }
        ]
      }
    }
    const manifest = validateManifest(raw)
    expect(manifest.contributions.chatActions?.[0].when).toEqual({
      field: 'chat.type',
      op: 'eq',
      value: 'GROUP'
    })
  })

  it('validates manifest with recursive tree when condition', () => {
    const raw = {
      ...baseManifest,
      contributions: {
        messageActions: [
          {
            id: 'msg-action-1',
            label: 'Msg Action 1',
            when: {
              all: [
                { field: 'message.isMedia', op: 'eq', value: true },
                { field: 'message.fromMe', op: 'eq', value: false }
              ]
            }
          }
        ]
      }
    }
    const manifest = validateManifest(raw)
    expect(manifest.contributions.messageActions?.[0].when).toBeDefined()
  })

  it('rejects legacy string when condition', () => {
    const raw = {
      ...baseManifest,
      contributions: {
        chatActions: [
          {
            id: 'action-1',
            label: 'Action 1',
            when: 'chat.isGroup'
          }
        ]
      }
    }
    expect(() => validateManifest(raw)).toThrow(ManifestValidationError)
  })

  it('rejects invalid when operator', () => {
    const raw = {
      ...baseManifest,
      contributions: {
        chatActions: [
          {
            id: 'action-1',
            label: 'Action 1',
            when: { field: 'chat.type', op: 'invalid_op', value: 'GROUP' }
          }
        ]
      }
    }
    expect(() => validateManifest(raw)).toThrow(ManifestValidationError)
  })
})
