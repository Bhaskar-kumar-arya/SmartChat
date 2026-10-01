import { describe, it, expect, vi, beforeEach } from 'vitest'

const ctor = vi.hoisted(() => vi.fn())

vi.mock('@lmstudio/sdk', () => {
  class LMStudioClient {
    public llm = { load: vi.fn(), unload: vi.fn().mockResolvedValue(undefined) }
    public system = { listDownloadedModels: vi.fn().mockResolvedValue([]) }
    constructor() {
      ctor()
    }
  }
  return { LMStudioClient, Chat: { empty: vi.fn(() => ({ append: vi.fn() })) } }
})

import { LMStudioProvider } from '../../../services/ai/providers/LMStudioProvider'
import type { IToolRegistry } from '../../../services/ai/IToolRegistry'

const registry = { getAllTools: vi.fn().mockReturnValue([]) } as unknown as IToolRegistry

describe('LMStudioProvider lazy connect', () => {
  beforeEach(() => ctor.mockClear())

  it('does not construct the SDK client (websocket) on provider construction or cleanup', async () => {
    const p = new LMStudioProvider(registry)
    expect(p.canHandleModel('lmstudio:x')).toBe(true)
    await p.cleanup()
    expect(ctor).not.toHaveBeenCalled()
  })

  it('constructs the client once, on first real use', async () => {
    const p = new LMStudioProvider(registry)
    await p.getAvailableModels()
    await p.getAvailableModels()
    expect(ctor).toHaveBeenCalledTimes(1)
  })
})
