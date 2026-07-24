import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ContextMenu } from '@renderer/components/common/ContextMenu'

describe('ContextMenu', () => {
  it('renders menu items at specified x and y coordinates', () => {
    const handleClose = vi.fn()
    const handleAction = vi.fn()

    render(
      <ContextMenu
        x={100}
        y={200}
        onClose={handleClose}
        items={[
          { label: 'Option 1', onClick: handleAction },
          { label: 'Option 2', danger: true }
        ]}
      />
    )

    expect(screen.getByText('Option 1')).toBeInTheDocument()
    expect(screen.getByText('Option 2')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Option 1'))
    expect(handleAction).toHaveBeenCalledTimes(1)
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('triggers onClose when clicking outside menu', () => {
    const handleClose = vi.fn()
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <ContextMenu
          x={50}
          y={50}
          onClose={handleClose}
          items={[{ label: 'Item 1' }]}
        />
      </div>
    )

    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(handleClose).toHaveBeenCalled()
  })

  it('renders sub-menu on hover', async () => {
    const handleSubAction = vi.fn()
    const handleClose = vi.fn()

    render(
      <ContextMenu
        x={50}
        y={50}
        onClose={handleClose}
        items={[
          {
            label: 'More',
            subMenu: [
              { label: 'Sub Item 1', onClick: handleSubAction }
            ]
          }
        ]}
      />
    )

    const moreItem = screen.getByText('More').closest('li')
    expect(moreItem).toBeInTheDocument()

    if (moreItem) {
      fireEvent.mouseEnter(moreItem)
      expect(await screen.findByText('Sub Item 1')).toBeInTheDocument()

      fireEvent.click(screen.getByText('Sub Item 1'))
      expect(handleSubAction).toHaveBeenCalledTimes(1)
      expect(handleClose).toHaveBeenCalledTimes(1)
    }
  })
})
