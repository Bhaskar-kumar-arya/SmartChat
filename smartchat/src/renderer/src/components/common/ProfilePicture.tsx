import React, { useState, useEffect } from 'react'
import { User, Users } from 'lucide-react'
import { api } from '../../services/api.service'

interface ProfilePictureProps {
  jid: string
  initialUrl?: string | null
  size?: number
  className?: string
  onClick?: (e: React.MouseEvent) => void
}

export const ProfilePicture: React.FC<ProfilePictureProps> = ({
  jid,
  initialUrl,
  size = 40,
  className = '',
  onClick
}) => {
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

  const getFallbackContent = () => {
    // Always use generic icons if no profile picture is available
    return jid.endsWith('@g.us') ? <Users size={size * 0.6} /> : <User size={size * 0.6} />
  }

  const fallback = (
    <div 
      className={`flex items-center justify-center text-white font-medium shrink-0 aspect-square overflow-hidden bg-linear-to-br from-emerald-500 to-emerald-600 ${className}`}
      style={{ width: size, height: size, fontSize: size / 2.5, borderRadius: '50%' }}
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
      className={`object-cover cursor-pointer hover:opacity-90 transition-opacity shrink-0 aspect-square overflow-hidden ${className}`}
      style={{ width: size, height: size, borderRadius: '50%' }}
      onClick={onClick}
      onError={handleImageError}
    />
  )
}
