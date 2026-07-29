import React, { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useAPI } from '../../context/APIContext'
import { EmojiText } from './EmojiText'

interface ProfilePicOverlayProps {
  jid: string
  name: string
  onClose: () => void
}

export const ProfilePicOverlay: React.FC<ProfilePicOverlayProps> = ({
  jid,
  name,
  onClose
}) => {
  const api = useAPI()
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchImage = async () => {
      try {
        const url = await api.getProfilePicture(jid, 'image')
        setImageUrl(url)
      } catch (err) {
        console.error('[ProfilePicOverlay] Error fetching full image:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchImage()
  }, [jid])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative max-w-2xl w-full mx-4 flex flex-col items-center">
        {/* Header */}
        <div className="absolute -top-12 left-0 right-0 flex justify-between items-center text-white px-2">
          <span className="text-lg font-medium"><EmojiText text={name} /></span>
          <button 
            onClick={onClose}
            className="p-1 hover:bg-white/10 rounded-full transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div style={{ background: 'var(--wa-bg-secondary)', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 25px 50px rgba(0,0,0,0.5)', minHeight: '300px', minWidth: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {loading ? (
            <div className="flex flex-col items-center space-y-4">
              <div style={{ width: '48px', height: '48px', border: '4px solid var(--wa-border)', borderTopColor: 'var(--wa-primary)', borderRadius: '9999px', animation: 'spin 1s linear infinite' }} />
              <span style={{ color: 'var(--wa-text-secondary)', fontSize: '0.875rem' }}>Loading full image...</span>
            </div>
          ) : imageUrl ? (
            <img 
              src={imageUrl} 
              alt={name} 
              className="max-h-[80vh] w-auto object-contain animate-in zoom-in-95 duration-300" 
            />
          ) : (
            <div style={{ color: 'var(--wa-text-tertiary)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px' }}>
              <span className="text-lg">No profile picture available</span>
            </div>
          )}
        </div>
      </div>
      
      {/* Click outside to close */}
      <div className="absolute inset-0 -z-10" onClick={onClose} />
    </div>
  )
}
