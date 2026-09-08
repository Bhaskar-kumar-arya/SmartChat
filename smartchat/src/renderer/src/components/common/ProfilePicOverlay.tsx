import React, { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useAPI } from '../../context/APIContext'
import { EmojiText } from './EmojiText'
import { BaseModal } from '../overlays/BaseModal'

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
    let alive = true
    const fetchImage = async () => {
      try {
        const url = await api.getProfilePicture(jid, 'image')
        if (alive) setImageUrl(url)
      } catch (err) {
        console.error('[ProfilePicOverlay] Error fetching full image:', err)
      } finally {
        if (alive) setLoading(false)
      }
    }
    fetchImage()
    return () => {
      alive = false
    }
  }, [jid])

  // BaseModal (F11-05): Escape to close, focus trap + restore, role="dialog",
  // and a real backdrop-click target. Styling is plain CSS (see modals.css) —
  // this app does not compile Tailwind, so utility classes never applied and
  // the overlay rendered unstyled in normal document flow.
  return (
    <BaseModal onClose={onClose} label={name} overlayClassName="profile-pic-overlay">
      <div className="profile-pic-dialog">
        <div className="profile-pic-dialog-header">
          <span className="profile-pic-dialog-name"><EmojiText text={name} /></span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="profile-pic-dialog-close"
          >
            <X size={24} />
          </button>
        </div>

        <div className="profile-pic-dialog-body">
          {loading ? (
            <div className="profile-pic-dialog-loading">
              <div className="profile-pic-dialog-spinner" />
              <span>Loading full image...</span>
            </div>
          ) : imageUrl ? (
            <img src={imageUrl} alt={name} className="profile-pic-dialog-image" />
          ) : (
            <div className="profile-pic-dialog-empty">
              <span>No profile picture available</span>
            </div>
          )}
        </div>
      </div>
    </BaseModal>
  )
}
