import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ContributionRegistry } from '../../../kernel/contributions/ContributionRegistry'
import { ChatActionContribution, SlashCommandContribution } from '../../../kernel/contributions/ContributionPoints'

describe('ContributionRegistry', () => {
  let registry: ContributionRegistry

  beforeEach(() => {
    registry = new ContributionRegistry()
  })

  it('registers a contribution and retrieves it via getAll()', () => {
    const contribution: ChatActionContribution = {
      pluginId: 'com.test.plugin',
      id: 'pin-chat',
      label: 'Pin Chat'
    }

    registry.register('chat-action', contribution)

    const actions = registry.getAll('chat-action')
    expect(actions).toHaveLength(1)
    expect(actions[0]).toEqual(contribution)
    expect(actions[0].pluginId).toBe('com.test.plugin')
  })

  it('getAll() returns empty array for unregistered slots', () => {
    const commands = registry.getAll('slash-command')
    expect(commands).toEqual([])
  })

  it('getAllSlots() returns all slots that have registered contributions', () => {
    expect(registry.getAllSlots()).toEqual([])
    registry.register('chat-action', { pluginId: 'p1', id: 'a1', label: 'A1' })
    registry.register('slash-command', { pluginId: 'p1', name: 'cmd', description: 'desc' })
    expect(registry.getAllSlots()).toEqual(['chat-action', 'slash-command'])
  })

  it('getAll() returns only contributions for the requested slot', () => {
    const action: ChatActionContribution = {
      pluginId: 'com.test.plugin',
      id: 'action-1',
      label: 'Action 1'
    }
    const command: SlashCommandContribution = {
      pluginId: 'com.test.plugin',
      name: 'hello',
      description: 'Say hello'
    }

    registry.register('chat-action', action)
    registry.register('slash-command', command)

    expect(registry.getAll('chat-action')).toEqual([action])
    expect(registry.getAll('slash-command')).toEqual([command])
  })

  it('unregisterAll() removes all contributions for a plugin across all slots', () => {
    const pluginAAction: ChatActionContribution = {
      pluginId: 'plugin-a',
      id: 'action-a',
      label: 'Action A'
    }
    const pluginACommand: SlashCommandContribution = {
      pluginId: 'plugin-a',
      name: 'cmd-a',
      description: 'Command A'
    }
    const pluginBAction: ChatActionContribution = {
      pluginId: 'plugin-b',
      id: 'action-b',
      label: 'Action B'
    }

    registry.register('chat-action', pluginAAction)
    registry.register('slash-command', pluginACommand)
    registry.register('chat-action', pluginBAction)

    registry.unregisterAll('plugin-a')

    expect(registry.getAll('chat-action')).toEqual([pluginBAction])
    expect(registry.getAll('slash-command')).toEqual([])
  })

  it('onChange() fires listener synchronously after register and unregisterAll', () => {
    const listener = vi.fn()
    registry.onChange(listener)

    expect(listener).not.toHaveBeenCalled()

    const action: ChatActionContribution = {
      pluginId: 'plugin-a',
      id: 'act',
      label: 'Act'
    }
    registry.register('chat-action', action)

    expect(listener).toHaveBeenCalledTimes(1)

    registry.unregisterAll('plugin-a')

    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('onChange() unsubscribe function works correctly', () => {
    const listener = vi.fn()
    const unsubscribe = registry.onChange(listener)

    const action: ChatActionContribution = {
      pluginId: 'plugin-a',
      id: 'act',
      label: 'Act'
    }
    registry.register('chat-action', action)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()

    registry.register('chat-action', { ...action, id: 'act-2' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('registering the same contribution twice from the same plugin does not deduplicate (both appear)', () => {
    const action: ChatActionContribution = {
      pluginId: 'plugin-a',
      id: 'duplicate-id',
      label: 'Dup Label'
    }

    registry.register('chat-action', action)
    registry.register('chat-action', action)

    const result = registry.getAll('chat-action')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(action)
    expect(result[1]).toEqual(action)
  })
})
