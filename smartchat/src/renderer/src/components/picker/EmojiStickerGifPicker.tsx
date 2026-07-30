import { useState, useEffect, useRef } from 'react'
import { Smile, Sticker, Search, Loader2, Sparkles, Compass } from 'lucide-react'
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react'
import { DEFAULT_STICKER_PACKS } from '../../utils/emojiData'
import { useAPI } from '../../context/APIContext'
import { useGiphy } from '../../hooks/useGiphy'
import ConfirmModal from '../common/ConfirmModal'

interface EmojiStickerGifPickerProps {
  onSelectEmoji?: (emoji: string) => void
  onSelectGif?: (filePath: string) => void | Promise<void>
  onSelectSticker?: (filePath: string) => void | Promise<void>
  onClose?: () => void
  initialTab?: 'emoji' | 'gif' | 'sticker'
}

export default function EmojiStickerGifPicker({
  onSelectEmoji,
  onSelectGif,
  onSelectSticker,
  onClose,
  initialTab = 'emoji'
}: EmojiStickerGifPickerProps) {
  const api = useAPI()
  const {
    gifs,
    giphyStickers,
    loading: giphyLoading,
    giphyError,
    fetchGiphy,
    clearGifs
  } = useGiphy()

  const [activeTab, setActiveTab] = useState<'emoji' | 'gif' | 'sticker'>(initialTab)
  const [searchQuery, setSearchQuery] = useState('')
  const [localLoading, setLocalLoading] = useState(false)
  const loading = giphyLoading || localLoading
  const [selectedPackIndex, setSelectedPackIndex] = useState<number>(-2)
  const [favoriteStickers, setFavoriteStickers] = useState<any[]>([])
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false)
  const [stickerToRemove, setStickerToRemove] = useState<any | null>(null)

  const searchInputRef = useRef<HTMLInputElement>(null)

  // Focus search input on tab change
  useEffect(() => {
    setSearchQuery('')
    clearGifs()
    setTimeout(() => searchInputRef.current?.focus(), 50)
  }, [activeTab, clearGifs])

  // Debounced search for GIPHY GIFs/Stickers
  useEffect(() => {
    if (activeTab === 'emoji') return

    const delay = searchQuery.trim() ? 500 : 0
    const timer = setTimeout(() => {
      if (activeTab === 'gif') {
        fetchGiphy(searchQuery, 'gifs')
      } else if (activeTab === 'sticker' && selectedPackIndex === -1) {
        // -1 represents Giphy sticker search tab
        fetchGiphy(searchQuery, 'stickers')
      }
    }, delay)

    return () => clearTimeout(timer)
  }, [searchQuery, activeTab, selectedPackIndex, fetchGiphy])

  // Trigger search when user switches to Giphy sticker tab
  useEffect(() => {
    if (activeTab === 'sticker' && selectedPackIndex === -1) {
      fetchGiphy(searchQuery, 'stickers')
    }
  }, [selectedPackIndex, activeTab])

  const handleEmojiClick = (emoji: string) => {
    onSelectEmoji?.(emoji)
  }


  const handleGifClick = async (gif: any) => {
    if (!onSelectGif) return
    // Use the fixed_height or original mp4 URL for native WhatsApp video playbacks
    const mp4Url = gif.images?.fixed_height?.mp4 || gif.images?.original?.mp4
    if (!mp4Url) return

    setLocalLoading(true)
    try {
      // Name it with gifplayback key so the backend sets gifPlayback: true
      const fileName = `giphy_gifplayback_${Date.now()}.mp4`
      const localPath = await api.downloadUrlToTemp(mp4Url, fileName)
      await onSelectGif(localPath)
      if (onClose) onClose()
    } catch (err) {
      console.error('Failed to process GIF selection:', err)
    } finally {
      setLocalLoading(false)
    }
  }

  const handleStickerClick = async (stickerUrl: string, name: string) => {
    if (!onSelectSticker) return
    // Convert gif URL to WebP to ensure it's sent as a native WhatsApp sticker
    const webpUrl = stickerUrl.replace('.gif', '.webp')
    setLocalLoading(true)
    try {
      const fileName = `sticker_${name.replace(/\s+/g, '_')}_${Date.now()}.webp`
      const localPath = await api.downloadUrlToTemp(webpUrl, fileName)
      await onSelectSticker(localPath)
      if (onClose) onClose()
    } catch (err) {
      console.error('Failed to process sticker selection:', err)
    } finally {
      setLocalLoading(false)
    }
  }

  const handleGiphyStickerClick = async (sticker: any) => {
    if (!onSelectSticker) return
    const webpUrl = sticker.images?.fixed_height?.webp || sticker.images?.original?.webp
    if (!webpUrl) return

    setLocalLoading(true)
    try {
      const fileName = `giphy_sticker_${sticker.id}_${Date.now()}.webp`
      const localPath = await api.downloadUrlToTemp(webpUrl, fileName)
      await onSelectSticker(localPath)
      if (onClose) onClose()
    } catch (err) {
      console.error('Failed to process Giphy sticker selection:', err)
    } finally {
      setLocalLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'sticker') {
      api.getFavoriteStickers().then(setFavoriteStickers).catch(console.error)
    }
  }, [activeTab])

  const handleRequestRemoveFavorite = (fav: any) => {
    setStickerToRemove(fav)
    setShowRemoveConfirm(true)
  }

  const handleConfirmRemoveFavorite = async () => {
    if (!stickerToRemove) return
    setShowRemoveConfirm(false)
    try {
      const success = await api.removeFavoriteStickerById(stickerToRemove.id)
      if (success) {
        setFavoriteStickers(prev => prev.filter(f => f.id !== stickerToRemove.id))
      }
    } catch (err) {
      console.error('Failed to remove favorite sticker:', err)
    } finally {
      setStickerToRemove(null)
    }
  }

  const handleFavoriteStickerClick = async (fav: any) => {
    if (!onSelectSticker) return
    setLocalLoading(true)
    try {
      await onSelectSticker(fav.localURI)
      if (onClose) onClose()
    } catch (err) {
      console.error('Failed to send favorite sticker:', err)
    } finally {
      setLocalLoading(false)
    }
  }



  return (
    <div className="emoji-picker-panel" onClick={e => e.stopPropagation()}>
      {/* Search Bar (Only shown for non-emoji tabs as EmojiPicker has its own) */}
      {activeTab !== 'emoji' && (
        <div className="picker-search-container">
          <div className="picker-search-wrapper">
            <Search size={16} className="picker-search-icon" />
            <input
              ref={searchInputRef}
              type="text"
              className="picker-search-input"
              placeholder={
                activeTab === 'gif' ? 'Search GIPHY GIFs...' : 'Search GIPHY Stickers...'
              }
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="picker-content">
        {loading && (
          <div className="picker-loading-overlay">
            <Loader2 className="spinner" size={24} />
          </div>
        )}

        {/* EMOJI TAB VIEW */}
        {activeTab === 'emoji' && (
          <EmojiPicker
            width="100%"
            height="100%"
            emojiStyle={EmojiStyle.APPLE}
            theme={Theme.DARK}
            lazyLoadEmojis={true}
            onEmojiClick={(emojiData) => handleEmojiClick(emojiData.emoji)}
          />
        )}

        {/* GIF TAB VIEW */}
        {activeTab === 'gif' && (
          <div className="gif-tab-container">
            {giphyError ? (
              <div className="picker-empty-state" style={{ color: '#ef5350', padding: '32px 16px' }}>
                <Compass size={32} />
                <p style={{ marginTop: '8px', fontWeight: 'bold' }}>{giphyError}</p>
                <p style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '6px' }}>
                  Please specify a valid <code>VITE_GIPHY_API_KEY</code> in your root <code>.env</code> file.
                </p>
              </div>
            ) : gifs.length === 0 && !loading ? (
              <div className="picker-empty-state">
                <Compass size={32} />
                <p>No GIFs found. Try searching for something else!</p>
              </div>
            ) : (
              <div className="gif-grid">
                {gifs.map(gif => {
                  const previewUrl = gif.images?.fixed_height_downsampled?.url || gif.images?.fixed_height_small?.url || gif.images?.fixed_height?.url
                  return (
                    <div
                      key={gif.id}
                      className="gif-item"
                      onClick={() => handleGifClick(gif)}
                    >
                      <img src={previewUrl} alt={gif.title} loading="lazy" />
                    </div>
                  )
                })}
              </div>
            )}
            <div className="giphy-attribution">Powered By GIPHY</div>
          </div>
        )}

        {/* STICKER TAB VIEW */}
        {activeTab === 'sticker' && (
          <div className="sticker-tab-container">
            {/* Sticker Pack Tabs */}
            <div className="sticker-packs-header">
              <button
                className={`sticker-pack-btn favorites-tab ${selectedPackIndex === -2 ? 'active' : ''}`}
                onClick={() => {
                  setSelectedPackIndex(-2)
                  api.getFavoriteStickers().then(setFavoriteStickers).catch(console.error)
                }}
                title="Starred Stickers"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill={selectedPackIndex === -2 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: selectedPackIndex === -2 ? '#e9c46a' : 'currentColor' }}>
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
              {DEFAULT_STICKER_PACKS.map((pack, idx) => (
                <button
                  key={pack.name}
                  className={`sticker-pack-btn ${selectedPackIndex === idx ? 'active' : ''}`}
                  onClick={() => setSelectedPackIndex(idx)}
                  title={pack.name}
                >
                  <img src={pack.stickers[0].url} alt={pack.name} className="sticker-pack-icon-img" />
                </button>
              ))}
              <button
                className={`sticker-pack-btn giphy-tab ${selectedPackIndex === -1 ? 'active' : ''}`}
                onClick={() => setSelectedPackIndex(-1)}
                title="Search Giphy Stickers"
              >
                <Compass size={18} />
              </button>
            </div>

            {/* Sticker list */}
            <div className="sticker-grid-scrollable">
              {selectedPackIndex === -2 ? (
                // Starred / Favorite Stickers
                favoriteStickers.length === 0 ? (
                  <div className="picker-empty-state">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, marginBottom: '8px' }}>
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                    <p>No starred stickers yet.</p>
                    <p style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '4px', textAlign: 'center', padding: '0 16px' }}>
                      Right-click or click options on any sticker in a chat and select "Star Sticker" to add it here.
                    </p>
                  </div>
                ) : (
                  <div className="sticker-grid">
                    {favoriteStickers.map(fav => (
                      <div
                        key={fav.id}
                        className="sticker-item favorite-item-container"
                        onClick={() => handleFavoriteStickerClick(fav)}
                      >
                        <img src={fav.localURI} alt="Favorite sticker" loading="lazy" />
                        <button
                          className="remove-favorite-btn"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRequestRemoveFavorite(fav)
                          }}
                          title="Remove from favorites"
                          style={{
                            position: 'absolute',
                            top: '2px',
                            right: '2px',
                            background: 'rgba(239, 83, 80, 0.95)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '50%',
                            width: '18px',
                            height: '18px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '12px',
                            cursor: 'pointer',
                            opacity: 0,
                            transition: 'opacity 0.2s ease',
                            padding: 0,
                            lineHeight: 1
                          }}
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                )
              ) : selectedPackIndex >= 0 ? (
                // Local static packs
                <div className="sticker-grid">
                  {DEFAULT_STICKER_PACKS[selectedPackIndex].stickers.map(st => (
                    <div
                      key={st.id}
                      className="sticker-item"
                      onClick={() => handleStickerClick(st.url, st.name)}
                    >
                      <img src={st.url} alt={st.name} loading="lazy" />
                    </div>
                  ))}
                </div>
              ) : (
                // Giphy Sticker search
                <>
                  {giphyError ? (
                    <div className="picker-empty-state" style={{ color: '#ef5350', padding: '32px 16px' }}>
                      <Sparkles size={32} />
                      <p style={{ marginTop: '8px', fontWeight: 'bold' }}>{giphyError}</p>
                      <p style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '6px' }}>
                        Please specify a valid <code>VITE_GIPHY_API_KEY</code> in your root <code>.env</code> file.
                      </p>
                    </div>
                  ) : giphyStickers.length === 0 && !loading ? (
                    <div className="picker-empty-state">
                      <Sparkles size={32} />
                      <p>Search millions of transparent stickers from GIPHY!</p>
                    </div>
                  ) : (
                    <div className="sticker-grid transparent">
                      {giphyStickers.map(st => {
                        const previewUrl = st.images?.fixed_height_small?.url || st.images?.fixed_height?.url
                        return (
                          <div
                            key={st.id}
                            className="sticker-item"
                            onClick={() => handleGiphyStickerClick(st)}
                          >
                            <img src={previewUrl} alt={st.title} loading="lazy" />
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <div className="giphy-attribution">Powered By GIPHY</div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Tabs Footer */}
      <div className="picker-footer-tabs-wrapper">
        <div className="picker-footer-tabs-pill">
          <button
            className={`picker-footer-tab ${activeTab === 'emoji' ? 'active' : ''}`}
            onClick={() => setActiveTab('emoji')}
            title="Emojis"
          >
            <Smile size={18} />
          </button>
          <button
            className={`picker-footer-tab ${activeTab === 'gif' ? 'active' : ''}`}
            onClick={() => setActiveTab('gif')}
            title="GIFs"
          >
            <span style={{ fontWeight: 'bold', fontSize: '0.75rem', letterSpacing: '0.5px' }}>GIF</span>
          </button>
          <button
            className={`picker-footer-tab ${activeTab === 'sticker' ? 'active' : ''}`}
            onClick={() => setActiveTab('sticker')}
            title="Stickers"
          >
            <Sticker size={18} />
          </button>
        </div>
      </div>
      <ConfirmModal
        isOpen={showRemoveConfirm}
        title="Remove Favorite"
        description="Are you sure you want to remove this sticker from your favorites?"
        confirmLabel="Remove"
        cancelLabel="Cancel"
        onConfirm={handleConfirmRemoveFavorite}
        onCancel={() => setShowRemoveConfirm(false)}
        isDanger={true}
      />
    </div>
  )
}
