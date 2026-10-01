import React, { useState, useEffect, useRef } from 'react'
import { useAPI } from '../../context/APIContext'

interface ProfilePictureProps {
  jid: string
  initialUrl?: string | null
  size?: number
  className?: string
  onClick?: (e: React.MouseEvent) => void
  isCommunity?: boolean
}

import { getAvatarColor, DefaultUserIcon, DefaultGroupIcon } from './DefaultAvatars'

export const ProfilePicture: React.FC<ProfilePictureProps> = ({
  jid,
  initialUrl,
  size = 40,
  className = '',
  onClick,
  isCommunity = false
}) => {
  const api = useAPI()
  const [url, setUrl] = useState<string | null>(initialUrl || null)
  const [retryAttempted, setRetryAttempted] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const jidRef = useRef(jid)
  useEffect(() => {
    jidRef.current = jid
  }, [jid])

  // Sync state with props when switching chats
  useEffect(() => {
    setUrl(initialUrl || null)
    setRetryAttempted(false)
    setLoadError(false)
  }, [jid, initialUrl])

  useEffect(() => {
    if (!url && jid && !loadError) {
      let alive = true
      const fetchPreview = async () => {
        try {
          const previewUrl = await api.getProfilePicture(jid, 'preview')
          // Bail if the component unmounted or switched to a different contact
          // while the IPC was in flight (avoids painting A's photo onto B).
          if (alive && previewUrl) setUrl(previewUrl)
        } catch (err) {
          console.error('[ProfilePicture] Error fetching preview:', err)
        }
      }
      fetchPreview()
      return () => {
        alive = false
      }
    }
    return undefined
  }, [jid, url, loadError])

  const handleImageError = async () => {
    if (!retryAttempted && jid) {
      setRetryAttempted(true)
      const requestedJid = jid
      try {
        const freshUrl = await api.getProfilePicture(jid, 'preview', true)
        // The header instance is reused across chats: drop the result if the
        // contact changed while the refresh was in flight (B-UIAPP-06).
        if (jidRef.current !== requestedJid) return
        if (freshUrl && freshUrl !== url) {
          setUrl(freshUrl)
          return
        }
      } catch (err) {
        console.error('[ProfilePicture] Error refreshing profile picture:', err)
        if (jidRef.current !== requestedJid) return
      }
    }
    // If we already retried or it failed again, show fallback
    setLoadError(true)
    setUrl(null)
  }

  const colorScheme = getAvatarColor(jid)
  const isGroup = jid.endsWith('@g.us') || isCommunity
  const borderRadius = isCommunity ? '30%' : '50%'

  const getFallbackContent = () => {
    return isGroup ? (
      <DefaultGroupIcon color={colorScheme.fg} />
    ) : (
      <DefaultUserIcon color={colorScheme.fg} />
    )
  }

  const fallback = (
    <div 
      className={`flex items-center justify-center shrink-0 overflow-hidden ${className}`}
      style={{ 
        width: size, 
        height: size, 
        backgroundColor: colorScheme.bg,
        borderRadius 
      }}
      onClick={onClick}
    >
      {getFallbackContent()}
    </div>
  )

  if (!url || loadError) return fallback

  return (
    <img
      src={url}
      alt="Profile"
      className={`object-cover cursor-pointer hover:opacity-90 transition-opacity shrink-0 overflow-hidden ${className}`}
      style={{ width: size, height: size, borderRadius }}
      onClick={onClick}
      onError={handleImageError}
    />
  )
}
