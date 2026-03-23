import React, { useState, useEffect } from 'react'
import { api } from '../services/api.service'

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

  useEffect(() => {
    if (!url && jid) {
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
  }, [jid, url])

  const fallback = (
    <div 
      className={`flex items-center justify-center text-white font-medium shrink-0 aspect-square overflow-hidden bg-linear-to-br from-emerald-500 to-emerald-600 ${className}`}
      style={{ width: size, height: size, fontSize: size / 2.5, borderRadius: '50%' }}
      onClick={onClick}
    >
      {jid.split('@')[0].slice(0, 1).toUpperCase()}
    </div>
  )

  if (!url) return fallback

  return (
    <img
      src={url}
      alt="Profile"
      className={`object-cover cursor-pointer hover:opacity-90 transition-opacity shrink-0 aspect-square overflow-hidden ${className}`}
      style={{ width: size, height: size, borderRadius: '50%' }}
      onClick={onClick}
      onError={() => setUrl(null)}
    />
  )
}
