import React, { useState, useEffect } from 'react'
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

  // Sync state with props when switching chats
  useEffect(() => {
    setUrl(initialUrl || null)
    setRetryAttempted(false)
    setLoadError(false)
  }, [jid, initialUrl])

  useEffect(() => {
    if (!url && jid && !loadError) {
      const fetchPreview = async () => {
        try {
          const previewUrl = await api.getProfilePicture(jid, 'preview')
          if (previewUrl) setUrl(previewUrl)
        } catch (err) {
          console.error('[ProfilePicture] Error fetching preview:', err)
        }
      }
      fetchPreview()
    }
  }, [jid, url, loadError])

  const handleImageError = async () => {
    if (!retryAttempted && jid) {
      setRetryAttempted(true)
      try {
        const freshUrl = await api.getProfilePicture(jid, 'preview', true)
        if (freshUrl && freshUrl !== url) {
          setUrl(freshUrl)
          return
        }
      } catch (err) {
        console.error('[ProfilePicture] Error refreshing profile picture:', err)
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
