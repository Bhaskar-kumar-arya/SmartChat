import { useState, useEffect, useRef, useCallback } from 'react'
import { ChatItem, SelectedContext } from '../types'
import { filterAndRank } from '../utils/mentionUtils'

interface UseMentionSessionOptions {
  chatList: ChatItem[]
  searchContacts: (query: string) => Promise<ChatItem[]>
  inputValue: string
  setInputValue: (val: string) => void
  mentions: SelectedContext[]
  setMentions: React.Dispatch<React.SetStateAction<SelectedContext[]>>
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  autoGrow: (el: HTMLTextAreaElement) => void
}

export function useMentionSession({
  chatList,
  searchContacts,
  inputValue,
  setInputValue,
  mentions,
  setMentions,
  inputRef,
  autoGrow
}: UseMentionSessionOptions) {
  // Position of the active triggering '@' in the text
  const [mentionAnchor, setMentionAnchor] = useState<number | null>(null)
  const [menuItems, setMenuItems] = useState<ChatItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searching, setSearching] = useState(false)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorRef = useRef<number | null>(null)

  useEffect(() => {
    anchorRef.current = mentionAnchor
  }, [mentionAnchor])

  // Clear query timeouts on unmount
  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [])

  // ── Search Effect (Fuzzy client-side + Debounced Server search) ───────────
  useEffect(() => {
    if (mentionAnchor === null) {
      setMenuItems([])
      setSearching(false)
      if (searchTimer.current) clearTimeout(searchTimer.current)
      return
    }

    const cursor = inputRef.current?.selectionStart ?? inputValue.length
    const query = inputValue.slice(mentionAnchor + 1, cursor)

    // Instantly filter client side so the menu shows up immediately
    setMenuItems(filterAndRank(chatList, query))
    setSelectedIndex(0)

    if (searchTimer.current) clearTimeout(searchTimer.current)

    if (query.length >= 1) {
      setSearching(true)
      searchTimer.current = setTimeout(async () => {
        try {
          const results = await searchContacts(query)
          // Make sure mention session is still active and hasn't changed anchor
          if (anchorRef.current !== null) {
            setMenuItems(results.slice(0, 10))
            setSelectedIndex(0)
          }
        } catch (err) {
          console.error('[MentionSession] Search failed:', err)
        } finally {
          setSearching(false)
        }
      }, 150)
    } else {
      setSearching(false)
    }

    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [mentionAnchor, inputValue, chatList, searchContacts, inputRef])

  // ── Handle Input Change Event ─────────────────────────────────────────────
  const onInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    const cursor = e.target.selectionStart ?? val.length
    setInputValue(val)
    autoGrow(e.target)

    if (mentionAnchor !== null) {
      // Close if cursor moved behind anchor, or if the '@' char was erased
      if (cursor <= mentionAnchor || val[mentionAnchor] !== '@') {
        setMentionAnchor(null)
      }
    } else {
      // Trigger new mention session when typing '@'
      if (cursor > 0 && val[cursor - 1] === '@') {
        setMentionAnchor(cursor - 1)
      }
    }
  }, [mentionAnchor, setInputValue, autoGrow])

  // ── Select Item from Dropdown ─────────────────────────────────────────────
  const selectItem = useCallback((chat: ChatItem) => {
    if (mentionAnchor === null || !inputRef.current) return
    const displayName = (chat.name || chat.jid.split('@')[0] || '??').trim()
    const cursor = inputRef.current.selectionStart ?? inputValue.length
    const before = inputValue.slice(0, mentionAnchor)
    const after = inputValue.slice(cursor)
    const token = `@${displayName} `
    const newVal = before + token + after
    const newPos = before.length + token.length

    setInputValue(newVal)
    setMentionAnchor(null)
    setMentions(prev => {
      if (prev.find(m => m.jid === chat.jid)) return prev
      return [...prev, { jid: chat.jid, name: displayName }]
    })

    requestAnimationFrame(() => {
      if (!inputRef.current) return
      inputRef.current.focus()
      inputRef.current.setSelectionRange(newPos, newPos)
      autoGrow(inputRef.current)
    })
  }, [mentionAnchor, inputValue, setInputValue, setMentions, inputRef, autoGrow])

  // ── Remove Chip Action ──────────────────────────────────────────────────
  const removeChip = useCallback((m: SelectedContext) => {
    const withSpace = `@${m.name} `
    const plain = `@${m.name}`
    
    // Replace only first occurrence of the mention token to support duplicate names safely
    const newText = inputValue.includes(withSpace)
      ? inputValue.replace(withSpace, '')
      : inputValue.includes(plain)
        ? inputValue.replace(plain, '')
        : inputValue

    setInputValue(newText)
    setMentions(prev => prev.filter(x => x.jid !== m.jid))
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [inputValue, setInputValue, setMentions, inputRef])

  // ── Backspace Mention Detection ───────────────────────────────────────────
  const handleBackspace = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!inputRef.current) return false
    const cursor = inputRef.current.selectionStart ?? 0
    const selEnd = inputRef.current.selectionEnd ?? 0

    if (cursor === selEnd) {
      const before = inputValue.slice(0, cursor)
      for (const m of mentions) {
        for (const token of [`@${m.name} `, `@${m.name}`]) {
          if (before.endsWith(token)) {
            e.preventDefault()
            const newText = inputValue.slice(0, cursor - token.length) + inputValue.slice(cursor)
            const newPos = cursor - token.length
            setInputValue(newText)
            setMentions(prev => prev.filter(x => x.jid !== m.jid))

            requestAnimationFrame(() => {
              if (!inputRef.current) return
              inputRef.current.setSelectionRange(newPos, newPos)
              autoGrow(inputRef.current)
            })
            return true
          }
        }
      }
    }
    return false
  }, [inputValue, mentions, setInputValue, setMentions, inputRef, autoGrow])

  return {
    mentionAnchor,
    setMentionAnchor,
    menuItems,
    selectedIndex,
    setSelectedIndex,
    searching,
    onInputChange,
    selectItem,
    removeChip,
    handleBackspace
  }
}
