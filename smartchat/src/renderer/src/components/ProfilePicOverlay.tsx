import React, { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { api } from '../services/api.service'

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
          <span className="text-lg font-medium">{name}</span>
          <button 
            onClick={onClose}
            className="p-1 hover:bg-white/10 rounded-full transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="bg-zinc-900 rounded-lg overflow-hidden shadow-2xl min-h-[300px] min-w-[300px] flex items-center justify-center">
          {loading ? (
            <div className="flex flex-col items-center space-y-4">
              <div className="w-12 h-12 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
              <span className="text-zinc-400 text-sm">Loading full image...</span>
            </div>
          ) : imageUrl ? (
            <img 
              src={imageUrl} 
              alt={name} 
              className="max-h-[80vh] w-auto object-contain animate-in zoom-in-95 duration-300" 
            />
          ) : (
            <div className="text-zinc-500 flex flex-col items-center p-8">
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
