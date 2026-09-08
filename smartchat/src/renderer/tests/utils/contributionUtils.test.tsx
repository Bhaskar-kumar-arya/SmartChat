import { describe, it, expect, vi } from 'vitest'
import { mapSubMenuItems } from '@renderer/utils/contributionUtils'
import type { SubMenuItemDeclaration } from '../../../../packages/sdk/src/manifest'

const action = { pluginId: 'com.test', id: 'act' }

function build(subItems: SubMenuItemDeclaration[]) {
  const exec = vi.fn().mockResolvedValue(undefined)
  return { items: mapSubMenuItems(subItems, action, 'chat-action', {}, exec), exec }
}

describe('mapSubMenuItems', () => {
  it('leaf item gets an onClick and no subMenu', () => {
    const { items, exec } = build([{ id: 'a', label: 'A', args: { foo: 1 } }])
    expect(items[0].subMenu).toBeUndefined()
    expect(typeof items[0].onClick).toBe('function')
    items[0].onClick!()
    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 'chat-action', pluginId: 'com.test', id: 'act', context: { foo: 1 } })
    )
  })

  it('parent with children gets a subMenu and no onClick', () => {
    const { items } = build([{ id: 'p', label: 'P', subMenu: [{ id: 'c', label: 'C' }] }])
    expect(items[0].subMenu).toHaveLength(1)
    expect(items[0].onClick).toBeUndefined()
  })

  // F2-05
  it('empty subMenu array is treated as a leaf (clickable, no dead arrow)', () => {
    const { items } = build([{ id: 'p', label: 'P', subMenu: [] }])
    expect(items[0].subMenu).toBeUndefined()
    expect(typeof items[0].onClick).toBe('function')
  })
})
