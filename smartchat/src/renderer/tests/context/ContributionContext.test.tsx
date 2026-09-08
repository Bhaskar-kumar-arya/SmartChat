import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'
import { APIProvider } from '@renderer/context/APIContext'
import { createMockApiService } from '../mocks/mockApiService'
import { ContributionProvider } from '@renderer/context/ContributionContext'
import { useContributions } from '@renderer/hooks/useContributions'
import { ContributionRegistrySnapshot } from '@renderer/types/contribution.types'

function ChatActionConsumer() {
  const actions = useContributions('chat-action')
  return (
    <div>
      <ul data-testid="action-list">
        {actions.map((act) => (
          <li key={`${act.pluginId}:${act.id}`} data-testid="action-item">
            {act.label}
          </li>
        ))}
      </ul>
      <span data-testid="action-count">{actions.length}</span>
    </div>
  )
}

function SidebarPanelConsumer() {
  const panels = useContributions('sidebar-panel')
  return <div data-testid="panel-count">{panels.length}</div>
}

describe('ContributionContext & useContributions', () => {
  it('fetches initial snapshot on mount and renders contributions', async () => {
    const mockSnapshot: ContributionRegistrySnapshot = {
      'chat-action': [
        { pluginId: 'com.builtin.wa', id: 'pin', label: 'Pin Chat' },
        { pluginId: 'com.builtin.wa', id: 'mute', label: 'Mute Chat' }
      ]
    }

    const apiService = createMockApiService({
      getContributions: vi.fn().mockResolvedValue(mockSnapshot)
    })

    render(
      <APIProvider service={apiService}>
        <ContributionProvider>
          <ChatActionConsumer />
        </ContributionProvider>
      </APIProvider>
    )

    expect(screen.getByTestId('action-count')).toHaveTextContent('0')

    await waitFor(() => {
      expect(screen.getByTestId('action-count')).toHaveTextContent('2')
    })

    const items = screen.getAllByTestId('action-item')
    expect(items[0]).toHaveTextContent('Pin Chat')
    expect(items[1]).toHaveTextContent('Mute Chat')
  })

  it('returns empty array when requested slot is unpopulated', async () => {
    const mockSnapshot: ContributionRegistrySnapshot = {
      'chat-action': [{ pluginId: 'com.builtin.wa', id: 'pin', label: 'Pin Chat' }]
    }

    const apiService = createMockApiService({
      getContributions: vi.fn().mockResolvedValue(mockSnapshot)
    })

    render(
      <APIProvider service={apiService}>
        <ContributionProvider>
          <SidebarPanelConsumer />
        </ContributionProvider>
      </APIProvider>
    )

    await waitFor(() => {
      expect(apiService.getContributions).toHaveBeenCalled()
    })

    expect(screen.getByTestId('panel-count')).toHaveTextContent('0')
  })

  it('updates state when onContributionsUpdated listener fires', async () => {
    let updateCallback: ((snapshot: ContributionRegistrySnapshot) => void) | undefined

    const initialSnapshot: ContributionRegistrySnapshot = {
      'chat-action': [{ pluginId: 'com.builtin.wa', id: 'pin', label: 'Pin Chat' }]
    }

    const updatedSnapshot: ContributionRegistrySnapshot = {
      'chat-action': [
        { pluginId: 'com.builtin.wa', id: 'pin', label: 'Pin Chat' },
        { pluginId: 'com.external.plugin', id: 'custom-action', label: 'Custom Action' }
      ]
    }

    const unsubscribeFn = vi.fn()
    const apiService = createMockApiService({
      getContributions: vi.fn().mockResolvedValue(initialSnapshot),
      onContributionsUpdated: vi.fn().mockImplementation((cb) => {
        updateCallback = cb
        return unsubscribeFn
      })
    })

    const { unmount } = render(
      <APIProvider service={apiService}>
        <ContributionProvider>
          <ChatActionConsumer />
        </ContributionProvider>
      </APIProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('action-count')).toHaveTextContent('1')
    })

    expect(updateCallback).toBeDefined()

    act(() => {
      if (updateCallback) {
        updateCallback(updatedSnapshot)
      }
    })

    expect(screen.getByTestId('action-count')).toHaveTextContent('2')
    expect(screen.getAllByTestId('action-item')[1]).toHaveTextContent('Custom Action')

    unmount()
    expect(unsubscribeFn).toHaveBeenCalled()
  })

  // F2-02
  it('does not let a slow initial fetch clobber a snapshot already set by an update event', async () => {
    let resolveFetch: (v: ContributionRegistrySnapshot) => void = () => {}
    let updateCallback: ((snapshot: ContributionRegistrySnapshot) => void) | undefined

    const staleSnapshot: ContributionRegistrySnapshot = {
      'chat-action': [{ pluginId: 'p', id: 'old', label: 'Old' }]
    }
    const freshSnapshot: ContributionRegistrySnapshot = {
      'chat-action': [
        { pluginId: 'p', id: 'old', label: 'Old' },
        { pluginId: 'p', id: 'new', label: 'New' }
      ]
    }

    const apiService = createMockApiService({
      getContributions: vi.fn().mockImplementation(
        () => new Promise<ContributionRegistrySnapshot>((res) => { resolveFetch = res })
      ),
      onContributionsUpdated: vi.fn().mockImplementation((cb) => {
        updateCallback = cb
        return vi.fn()
      })
    })

    render(
      <APIProvider service={apiService}>
        <ContributionProvider>
          <ChatActionConsumer />
        </ContributionProvider>
      </APIProvider>
    )

    // Update event arrives first...
    act(() => updateCallback?.(freshSnapshot))
    expect(screen.getByTestId('action-count')).toHaveTextContent('2')

    // ...then the slow initial fetch resolves with an older snapshot.
    await act(async () => {
      resolveFetch(staleSnapshot)
    })

    expect(screen.getByTestId('action-count')).toHaveTextContent('2')
  })

  // F2-06
  it('returns a stable reference for an unpopulated slot across re-renders', () => {
    const seen: unknown[] = []
    function Probe() {
      const panels = useContributions('sidebar-panel')
      seen.push(panels)
      const [, force] = useState(0)
      ;(Probe as any)._force = force
      return null
    }

    const apiService = createMockApiService({
      getContributions: vi.fn().mockReturnValue(new Promise(() => {}))
    })

    render(
      <APIProvider service={apiService}>
        <ContributionProvider>
          <Probe />
        </ContributionProvider>
      </APIProvider>
    )

    act(() => (Probe as any)._force((n: number) => n + 1))
    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(seen[0]).toBe(seen[seen.length - 1])
  })
})
