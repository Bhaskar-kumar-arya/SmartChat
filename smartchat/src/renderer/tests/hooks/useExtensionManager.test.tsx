import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useExtensionManager } from '@renderer/hooks/useExtensionManager'
import { APIProvider } from '@renderer/context/APIContext'
import { createMockApiService } from '../mocks/mockApiService'

describe('useExtensionManager', () => {
  let mockApi: ReturnType<typeof createMockApiService>

  const createWrapper = (api = mockApi) => {
    return ({ children }: { children: React.ReactNode }) => (
      <APIProvider service={api}>{children}</APIProvider>
    )
  }

  beforeEach(() => {
    mockApi = createMockApiService({
      extensionList: vi.fn().mockResolvedValue([
        { id: 'ext-1', name: 'Extension One', version: '1.0.0', state: 'active' },
      ]),
      extensionInstall: vi.fn().mockResolvedValue({}),
      extensionUnload: vi.fn().mockResolvedValue(undefined),
      extensionReload: vi.fn().mockResolvedValue(undefined),
      extensionUninstall: vi.fn().mockResolvedValue(undefined),
      extensionGetDocs: vi.fn().mockResolvedValue('API Docs'),
    })

    Object.defineProperty(navigator, 'clipboard', {
      writable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('should fetch extensions list on mount', async () => {
    const { result } = renderHook(() => useExtensionManager(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.extensions).toHaveLength(1)
    expect(result.current.extensions[0].id).toBe('ext-1')
  })

  it('should handle lifecycle operations (install, unload, reload, uninstall)', async () => {
    const { result } = renderHook(() => useExtensionManager(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.install('/path/to/ext.scext')
    })
    expect(mockApi.extensionInstall).toHaveBeenCalledWith('/path/to/ext.scext')

    await act(async () => {
      await result.current.unload('ext-1')
    })
    expect(mockApi.extensionUnload).toHaveBeenCalledWith('ext-1')

    await act(async () => {
      await result.current.reload('ext-1')
    })
    expect(mockApi.extensionReload).toHaveBeenCalledWith('ext-1')

    await act(async () => {
      await result.current.uninstall('ext-1')
    })
    expect(mockApi.extensionUninstall).toHaveBeenCalledWith('ext-1')
  })
})
