import React, { useEffect, useRef, useState } from 'react'
import './ContextMenu.css'

export interface ContextMenuItem {
  label: string
  onClick?: () => void
  icon?: React.ReactNode
  danger?: boolean
  subMenu?: ContextMenuItem[]
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState({ left: x, top: y })

  useEffect(() => {
    // Click outside handler
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    // Scroll close handler
    const handleScroll = () => {
      onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('scroll', handleScroll, true)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('scroll', handleScroll, true)
    }
  }, [onClose])

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect()
      let left = x
      let top = y

      // Check right boundary overflow
      if (x + rect.width > window.innerWidth) {
        left = window.innerWidth - rect.width - 8
      }

      // Check bottom boundary overflow
      if (y + rect.height > window.innerHeight) {
        top = window.innerHeight - rect.height - 8
      }

      // Ensure we don't render off-screen left or top
      left = Math.max(8, left)
      top = Math.max(8, top)

      setCoords({ left, top })
    }
  }, [x, y, items])

  return (
    <div
      ref={menuRef}
      className="custom-context-menu"
      style={{
        left: coords.left,
        top: coords.top,
      }}
    >
      <ul className="context-menu-list">
        {items.map((item, idx) => (
          <ContextMenuItemRow key={idx} item={item} onClose={onClose} />
        ))}
      </ul>
    </div>
  )
}

interface ContextMenuItemRowProps {
  item: ContextMenuItem
  onClose: () => void
}

const ContextMenuItemRow: React.FC<ContextMenuItemRowProps> = ({ item, onClose }) => {
  const [isSubOpen, setIsSubOpen] = useState(false)
  const rowRef = useRef<HTMLLIElement>(null)
  const [subCoords, setSubCoords] = useState({ left: 0, top: 0 })
  const leaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = () => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current)
      leaveTimeoutRef.current = null
    }

    if (item.subMenu && rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect()
      let left = rect.width - 2 // slightly overlap to prevent gap triggering mouseleave
      let top = 0

      // Submenu positioning bounds checking
      const menuWidth = 160 // Approximate width of submenu
      if (rect.right + menuWidth > window.innerWidth) {
        left = -menuWidth + 2
      }

      setSubCoords({ left, top })
      setIsSubOpen(true)
    }
  }

  const handleMouseLeave = () => {
    if (item.subMenu) {
      leaveTimeoutRef.current = setTimeout(() => {
        setIsSubOpen(false)
      }, 300) // 300ms grace period for diagonal cursor movement
    } else {
      setIsSubOpen(false)
    }
  }

  useEffect(() => {
    return () => {
      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current)
      }
    }
  }, [])

  const handleClick = (e: React.MouseEvent) => {
    if (item.subMenu) {
      e.stopPropagation()
      return
    }
    if (item.onClick) {
      item.onClick()
      onClose()
    }
  }

  return (
    <li
      ref={rowRef}
      className={`context-menu-item ${item.danger ? 'danger' : ''} ${item.subMenu ? 'has-submenu' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      <div className="context-menu-item-content">
        {item.icon && <span className="context-menu-icon">{item.icon}</span>}
        <span className="context-menu-label">{item.label}</span>
        {item.subMenu && (
          <span className="context-menu-arrow">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6"/>
            </svg>
          </span>
        )}
      </div>

      {item.subMenu && isSubOpen && (
        <div
          className="custom-context-menu-submenu"
          style={{
            left: subCoords.left,
            top: subCoords.top,
          }}
        >
          <ul className="context-menu-list">
            {item.subMenu.map((subItem, idx) => (
              <ContextMenuItemRow key={idx} item={subItem} onClose={onClose} />
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}
