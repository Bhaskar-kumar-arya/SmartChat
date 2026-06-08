import { useState, useMemo } from 'react'
import { ChatItem, ExtendedChatItem } from '../types'

/**
 * Custom hook to manage the community hierarchy sorting and rendering states.
 * Encapsulates the 5-pass sorting algorithm and expansion toggling.
 */
export const useChatHierarchy = (
  chats: ChatItem[],
  onSelectChat?: (jid: string, name: string, profilePictureUrl?: string | null) => void,
  clearUnreadCount?: (jid: string) => void
) => {
  const [expandedCommunities, setExpandedCommunities] = useState<Set<string>>(new Set())

  const { groupedChats, childrenByParent } = useMemo(() => {
    const roots: ChatItem[] = []
    const childrenByParent = new Map<string, ChatItem[]>()
    const processedJids = new Set<string>()
    
    // Pass 1: Identify all community roots and build children map
    chats.forEach(chat => {
      if (chat.isCommunity) {
        roots.push(chat)
        processedJids.add(chat.jid)
      } else if (chat.linkedParentJid) {
        const existing = childrenByParent.get(chat.linkedParentJid) || []
        childrenByParent.set(chat.linkedParentJid, [...existing, chat])
        processedJids.add(chat.jid)
      }
    })

    // Pass 2: Identify standalone chats
    const standaloneChats = chats.filter(chat => !processedJids.has(chat.jid))

    // Pass 3: Calculate effective timestamps for sortable items
    const sortableItems = [
      ...standaloneChats.map(chat => ({ 
        chat, 
        effectiveTimestamp: BigInt(chat.lastMessageTimestamp || chat.timestamp || 0) 
      })),
      ...roots.map(root => {
        const children = childrenByParent.get(root.jid) || []
        const timestamps = [
          BigInt(root.lastMessageTimestamp || root.timestamp || 0),
          ...children.map(c => BigInt(c.lastMessageTimestamp || c.timestamp || 0))
        ]
        return { 
          chat: root, 
          effectiveTimestamp: timestamps.reduce((max, curr) => curr > max ? curr : max, 0n)
        }
      })
    ]

    // Pass 4: Sort by effective timestamp descending
    sortableItems.sort((a, b) => {
      if (b.effectiveTimestamp > a.effectiveTimestamp) return 1
      if (b.effectiveTimestamp < a.effectiveTimestamp) return -1
      return 0
    })

    // Pass 5: Flatten for rendering
    const finalItems: ExtendedChatItem[] = []
    sortableItems.forEach(item => {
      const children = childrenByParent.get(item.chat.jid) || []
      
      if (item.chat.isCommunity) {
        const totalUnreadCount = children.reduce((sum, c) => sum + (c.unreadCount || 0), 0)
        
        let latestChildTimestamp: string | null = null
        let maxTs = 0n
        children.forEach(c => {
          const ts = BigInt(c.lastMessageTimestamp || c.timestamp || 0)
          if (ts > maxTs) {
            maxTs = ts
            latestChildTimestamp = c.lastMessageTimestamp || c.timestamp || null
          }
        })

        const displayTimestamp = latestChildTimestamp || item.chat.lastMessageTimestamp || item.chat.timestamp

        finalItems.push({ 
          ...item.chat, 
          totalUnreadCount, 
          children,
          lastMessageTimestamp: displayTimestamp,
          timestamp: displayTimestamp
        })
        
        children.forEach(child => {
          finalItems.push({ ...child, isChild: true, parentName: item.chat.name })
        })
      } else {
        finalItems.push(item.chat)
      }
    })

    return { groupedChats: finalItems, childrenByParent }
  }, [chats])

  const toggleExpand = (jid: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setExpandedCommunities(prev => {
      const next = new Set(prev)
      if (next.has(jid)) next.delete(jid)
      else next.add(jid)
      return next
    })
  }

  const handleRootClick = (root: ChatItem) => {
    const isExpanded = expandedCommunities.has(root.jid)
    
    if (isExpanded) {
      toggleExpand(root.jid)
    } else {
      const children = childrenByParent.get(root.jid) || []
      if (children.length > 0) {
        const target = children.find(c => c.unreadCount > 0) || children[0]
        if (onSelectChat) {
          onSelectChat(target.jid, target.name, target.profilePictureUrl)
        }
        if (clearUnreadCount) {
          clearUnreadCount(target.jid)
        }
        
        setExpandedCommunities(prev => {
          const next = new Set(prev)
          next.add(root.jid)
          return next
        })
      } else {
        if (onSelectChat) {
          onSelectChat(root.jid, root.name, root.profilePictureUrl)
        }
      }
    }
  }

  return {
    groupedChats,
    childrenByParent,
    expandedCommunities,
    toggleExpand,
    handleRootClick
  }
}
