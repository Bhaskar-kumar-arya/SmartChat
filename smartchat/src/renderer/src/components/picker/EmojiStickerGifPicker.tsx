import { useState, useEffect, useRef } from 'react'
import { Smile, Sticker, Search, Loader2, Compass, Sparkles, Heart, Users, Trees, Utensils, Activity, Lightbulb, Flag } from 'lucide-react'
import { EMOJI_CATEGORIES, DEFAULT_STICKER_PACKS } from '../../utils/emojiData'
import { useAPI } from '../../context/APIContext'
import { useGiphy } from '../../hooks/useGiphy'
import { matchEmoji } from '../../utils/emojiKeywords'

const categoryIconMap: Record<string, React.ReactNode> = {
  Smileys: <Smile size={18} />,
  Gestures: <Heart size={18} />,
  People: <Users size={18} />,
  Nature: <Trees size={18} />,
  Food: <Utensils size={18} />,
  Activities: <Activity size={18} />,
  Objects: <Lightbulb size={18} />,
  Symbols: <Flag size={18} />
}

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
  const [selectedPackIndex, setSelectedPackIndex] = useState<number>(0)
  const [selectedEmojiCategory, setSelectedEmojiCategory] = useState<string>('Smileys')

  const emojiCategoryRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const emojiContainerRef = useRef<HTMLDivElement>(null)
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

  const handleEmojiScroll = () => {
    if (!emojiContainerRef.current) return
    const container = emojiContainerRef.current
    const containerTop = container.getBoundingClientRect().top

    let currentCategory = EMOJI_CATEGORIES[0].name
    for (const cat of EMOJI_CATEGORIES) {
      const el = emojiCategoryRefs.current[cat.name]
      if (el) {
        const rect = el.getBoundingClientRect()
        if (rect.top - containerTop <= 50) {
          currentCategory = cat.name
        }
      }
    }
    setSelectedEmojiCategory(currentCategory)
  }

  const scrollToEmojiCategory = (categoryName: string) => {
    const el = emojiCategoryRefs.current[categoryName]
    if (el && emojiContainerRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setSelectedEmojiCategory(categoryName)
    }
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

  // Filter emojis based on query
  const filteredEmojiCategories = EMOJI_CATEGORIES.map(cat => ({
    ...cat,
    emojis: cat.emojis.filter(emoji => {
      if (!searchQuery.trim()) return true
      return matchEmoji(emoji, searchQuery)
    })
  })).filter(cat => cat.emojis.length > 0)

  // Fallback search match: search emojis directly in a flattened way
  const flattenedEmojis = EMOJI_CATEGORIES.flatMap(cat => cat.emojis)
  const isSingleEmojiSearch = searchQuery.trim().length > 0 && (
    flattenedEmojis.includes(searchQuery.trim()) ||
    filteredEmojiCategories.some(cat => cat.emojis.includes(searchQuery.trim()))
  )

  return (
    <div className="emoji-picker-panel" onClick={e => e.stopPropagation()}>
      {/* Search Bar */}
      <div className="picker-search-container">
        <div className="picker-search-wrapper">
          <Search size={16} className="picker-search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="picker-search-input"
            placeholder={
              activeTab === 'emoji' ? 'Search emojis...' :
              activeTab === 'gif' ? 'Search GIPHY GIFs...' : 'Search GIPHY Stickers...'
            }
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Main Content Area */}
      <div className="picker-content">
        {loading && (
          <div className="picker-loading-overlay">
            <Loader2 className="spinner" size={24} />
          </div>
        )}

        {/* EMOJI TAB VIEW */}
        {activeTab === 'emoji' && (
          <div className="emoji-tab-container">
            {/* Category Quick Selector */}
            <div className="emoji-categories-header">
              {EMOJI_CATEGORIES.map(cat => (
                <button
                  key={cat.name}
                  className={`emoji-cat-btn ${selectedEmojiCategory === cat.name ? 'active' : ''}`}
                  onClick={() => scrollToEmojiCategory(cat.name)}
                  title={cat.name}
                >
                  {categoryIconMap[cat.name] || cat.icon}
                </button>
              ))}
            </div>

            {/* Emoji Grid list */}
            <div
              ref={emojiContainerRef}
              className="emoji-grid-scrollable"
              onScroll={handleEmojiScroll}
            >
              {searchQuery.trim() && !isSingleEmojiSearch ? (
                // If the user searches by keyword, search emoji keywords (we fallback to simple regex or basic character checks)
                <div className="emoji-category-section">
                  <div className="emoji-category-title">Search Results</div>
                  <div className="emoji-grid">
                    {/* Basic emoji search mock: filter standard categories */}
                    {filteredEmojiCategories.map(cat => 
                      cat.emojis.map(emoji => (
                        <button
                          key={emoji}
                          className="emoji-item"
                          onClick={() => onSelectEmoji?.(emoji)}
                        >
                          {emoji}
                        </button>
                      ))
                    )}
                    {filteredEmojiCategories.length === 0 && (
                      <div className="no-results">No matching emojis found</div>
                    )}
                  </div>
                </div>
              ) : (
                filteredEmojiCategories.map(cat => (
                  <div
                    key={cat.name}
                    ref={el => { emojiCategoryRefs.current[cat.name] = el }}
                    className="emoji-category-section"
                  >
                    <div className="emoji-category-title">{cat.name}</div>
                    <div className="emoji-grid">
                      {cat.emojis.map(emoji => (
                        <button
                          key={emoji}
                          className="emoji-item"
                          onClick={() => onSelectEmoji?.(emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
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
              {selectedPackIndex !== -1 ? (
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
    </div>
  )
}
