import { useEffect, useState } from 'react'
import { api } from '../../services/api.service'
export { AudioMessage } from './AudioMessage'

const formatFileSize = (bytes?: number | string) => {
  if (!bytes) return ''
  const num = Number(bytes)
  if (isNaN(num)) return ''
  if (num < 1024) return `${num} B`
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(0)} kB`
  return `${(num / (1024 * 1024)).toFixed(1)} MB`
}

const getDisplayDimensions = (originalWidth?: number, originalHeight?: number) => {
  const maxWidth = 300
  const maxHeight = 400
  const minWidth = 180
  const minHeight = 150

  // Fallback if dimensions are missing or invalid
  if (!originalWidth || !originalHeight) {
    return { width: maxWidth, height: 200 }
  }

  let width = originalWidth
  let height = originalHeight

  const aspectRatio = width / height

  // Scale down proportionally to fit within maxWidth and maxHeight limits
  if (width > maxWidth) {
    width = maxWidth
    height = Math.round(width / aspectRatio)
  }
  
  if (height > maxHeight) {
    height = maxHeight
    width = Math.round(height * aspectRatio)
  }

  // Enforce minimums while preserving aspect ratio
  if (width < minWidth) {
    width = minWidth
    height = Math.round(width / aspectRatio)
  }

  if (height < minHeight) {
    height = minHeight
    width = Math.round(height * aspectRatio)
  }

  // Final constraint clamp to ensure limits are strictly respected
  if (width > maxWidth) width = maxWidth
  if (height > maxHeight) height = maxHeight

  return { width, height }
}



interface MediaMessageProps {
  localURI?: string
  textContent?: string | null
  mentions?: Record<string, string>
  onDownload: () => void
  isDownloading: boolean
  label: string
  icon: any
  downloadFailed?: boolean
}

/**
 * Common layout for media that is not yet downloaded.
 */
export const DownloadMediaPlaceholder = ({ onDownload, isDownloading, label, icon, downloadFailed }: MediaMessageProps) => {
  return (
    <div className="message-image-download" style={{
        marginBottom: '0',
        padding: '24px',
        borderRadius: '12px',
        background: 'var(--surface, rgba(0,0,0,0.05))',
        border: '1px dashed var(--border, #ccc)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        minWidth: '200px'
    }}>
        {isDownloading ? (
        <div className="spinner-small" style={{ margin: '8px' }} />
        ) : downloadFailed ? (
        <div style={{ textAlign: 'center', color: 'var(--text-secondary, #888)', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
            <div style={{ color: '#ea4335' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </div>
            <span>{label} Expired</span>
        </div>
        ) : (
        <div style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: '12px' }}>
                {icon}
            </div>
            <button
            onClick={onDownload}
            style={{
                padding: '8px 16px',
                borderRadius: '16px',
                border: 'none',
                background: 'var(--primary, #00a884)',
                color: '#fff',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                width: '100%'
            }}
            >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            Download {label}
            </button>
        </div>
        )}
    </div>
  )
}

export const ImageMessage = ({ localURI, textContent, rawMsg, onDownload, isDownloading }: any) => {
  const [downloadFailed, setDownloadFailed] = useState(false)
  const thumbnailData = getThumbnailData(rawMsg?.imageMessage)

  const imgMsg = rawMsg?.imageMessage || {}
  const width = imgMsg.width
  const height = imgMsg.height
  const fileLength = imgMsg.fileLength
  const fileSizeStr = formatFileSize(fileLength)

  const { width: dispWidth, height: dispHeight } = getDisplayDimensions(width, height)

  const handleDownload = async () => {
    if (onDownload) {
      setDownloadFailed(false)
      try {
        await onDownload()
      } catch (err) {
        console.error('Failed to download image:', err)
        setDownloadFailed(true)
      }
    }
  }

  if (!localURI) {
    if (thumbnailData) {
      return (
        <div className="message-image-placeholder" style={{ 
          marginBottom: textContent ? '8px' : '0',
          position: 'relative', 
          overflow: 'hidden', 
          borderRadius: '12px',
          width: `${dispWidth}px`,
          height: `${dispHeight}px`,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'rgba(0,0,0,0.1)'
        }}>
          {/* Blurred Thumbnail Background */}
          <img 
            src={thumbnailData} 
            alt="Preview" 
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              filter: 'blur(5px)',
              transform: 'scale(1.05)',
              opacity: 0.95,
              transition: 'opacity 0.3s ease'
            }} 
          />
          
          {/* Semi-transparent Download Overlay */}
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.15)',
            zIndex: 2
          }}>
            {isDownloading ? (
              <div className="spinner-small" style={{ width: '28px', height: '28px' }} />
            ) : downloadFailed ? (
              <div style={{
                background: 'rgba(234, 67, 53, 0.85)',
                padding: '6px 12px',
                borderRadius: '16px',
                color: '#fff',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 600,
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
              }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                Expired
              </div>
            ) : (
              <button
                onClick={handleDownload}
                style={{
                  padding: '8px 16px',
                  borderRadius: '24px',
                  border: 'none',
                  background: 'rgba(0, 0, 0, 0.5)',
                  backdropFilter: 'blur(10px)',
                  color: '#fff',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  transition: 'background 0.2s, transform 0.1s'
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(0, 0, 0, 0.65)')}
                onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(0, 0, 0, 0.5)')}
                title="Download Image"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                {fileSizeStr && <span style={{ whiteSpace: 'nowrap' }}>{fileSizeStr}</span>}
              </button>
            )}
          </div>
        </div>
      )
    }

    return <DownloadMediaPlaceholder 
      label="Image" 
      icon={<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>}
      onDownload={handleDownload}
      isDownloading={isDownloading}
      downloadFailed={downloadFailed}
    />
  }

  return (
    <div className="message-image" style={{ 
      marginBottom: textContent ? '8px' : '0',
      borderRadius: '12px',
      overflow: 'hidden',
      cursor: 'pointer',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      background: 'rgba(0,0,0,0.05)',
      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.1)',
      width: `${dispWidth}px`,
      height: `${dispHeight}px`
    }} onClick={() => api.openFile(localURI)}>
      <img src={localURI} alt="Media" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
    </div>
  )
}

export const StickerMessage = ({ localURI, rawMsg, onDownload, isDownloading }: any) => {
    const [downloadFailed, setDownloadFailed] = useState(false)

    const handleDownload = async () => {
        if (onDownload) {
            setDownloadFailed(false)
            try {
                await onDownload()
            } catch (err) {
                console.error('Failed to download sticker:', err)
                setDownloadFailed(true)
            }
        }
    }

    useEffect(() => {
        if (!localURI && !isDownloading && onDownload && !downloadFailed) {
            handleDownload()
        }
    }, [localURI, isDownloading, onDownload, downloadFailed])

    const thumbnailData = getThumbnailData(rawMsg?.stickerMessage)

    if (!localURI) {
        if (downloadFailed) {
            return (
                <div className="message-sticker-placeholder" style={{ 
                    width: '150px',
                    height: '150px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0,0,0,0.05)',
                    borderRadius: '8px',
                    color: 'var(--text-secondary, #888)',
                    fontSize: '0.8rem',
                    gap: '6px',
                    padding: '8px',
                    textAlign: 'center'
                }}>
                    <div style={{ color: '#ea4335' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    </div>
                    <span>Sticker Expired</span>
                </div>
            )
        }

        if (thumbnailData) {
            return (
                <div className="message-sticker-placeholder" style={{ 
                    position: 'relative', 
                    overflow: 'hidden', 
                    borderRadius: '8px',
                    width: '150px',
                    height: '150px',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    background: 'transparent'
                }}>
                    <img 
                        src={thumbnailData} 
                        alt="Preview" 
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain',
                            filter: 'blur(3px)',
                            opacity: 0.95,
                            transition: 'opacity 0.3s ease'
                        }} 
                    />
                    
                    <div style={{
                        position: 'absolute',
                        top: 0, left: 0, right: 0, bottom: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(0, 0, 0, 0.15)',
                        zIndex: 2
                    }}>
                        {isDownloading ? (
                            <div className="spinner-small" style={{ width: '24px', height: '24px' }} />
                        ) : (
                            <button
                                onClick={handleDownload}
                                style={{
                                    width: '36px',
                                    height: '36px',
                                    borderRadius: '50%',
                                    border: 'none',
                                    background: 'rgba(0, 0, 0, 0.5)',
                                    color: '#fff',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: '0 2px 6px rgba(0,0,0,0.3)'
                                }}
                                title="Download Sticker"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                            </button>
                        )}
                    </div>
                </div>
            )
        }

        return <DownloadMediaPlaceholder 
            label="Sticker" 
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>}
            onDownload={handleDownload}
            isDownloading={isDownloading}
            downloadFailed={downloadFailed}
        />
    }

    return (
        <div className="message-sticker">
            <img src={localURI} alt="Sticker" style={{ cursor: 'pointer' }} onClick={() => api.openFile(localURI)} />
        </div>
    )
}

const getThumbnailData = (media: any) => {
    if (!media || !media.jpegThumbnail) return undefined
    const thumb = media.jpegThumbnail
    if (typeof thumb === 'string') {
        return thumb.startsWith('data:') ? thumb : `data:image/jpeg;base64,${thumb}`
    }
    if (thumb && typeof thumb === 'object' && thumb.type === 'Buffer' && Array.isArray(thumb.data)) {
        const uint8 = new Uint8Array(thumb.data)
        let binary = ''
        for (let i = 0; i < uint8.byteLength; i++) binary += String.fromCharCode(uint8[i])
        return `data:image/jpeg;base64,${window.btoa(binary)}`
    }
    return undefined
}

export const VideoMessage = ({ localURI, textContent, rawMsg, onDownload, isDownloading }: any) => {
    const [downloadFailed, setDownloadFailed] = useState(false)
    const thumbnailData = getThumbnailData(rawMsg?.videoMessage)
    const vidMsg = rawMsg?.videoMessage || {}
    const width = vidMsg.width
    const height = vidMsg.height
    const fileLength = vidMsg.fileLength
    const fileSizeStr = formatFileSize(fileLength)
    const duration = vidMsg.seconds
    const formatDuration = (secs?: number) => {
        if (!secs) return ''
        const mins = Math.floor(secs / 60)
        const remSecs = secs % 60
        return `${mins}:${remSecs.toString().padStart(2, '0')}`
    }

    const { width: dispWidth, height: dispHeight } = getDisplayDimensions(width, height)

    const handleDownload = async () => {
        if (onDownload) {
            setDownloadFailed(false)
            try {
                await onDownload()
            } catch (err) {
                console.error('Failed to download video:', err)
                setDownloadFailed(true)
            }
        }
    }

    if (!localURI) {
        if (thumbnailData) {
            return (
                <div className="message-video-placeholder" style={{ 
                    marginBottom: textContent ? '8px' : '0',
                    position: 'relative', 
                    overflow: 'hidden', 
                    borderRadius: '12px',
                    width: `${dispWidth}px`,
                    height: `${dispHeight}px`,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    background: '#000'
                }}>
                    {/* Blurred Thumbnail Background */}
                    <img 
                        src={thumbnailData} 
                        alt="Preview" 
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            filter: 'blur(5px)',
                            transform: 'scale(1.05)',
                            opacity: 0.95,
                            transition: 'opacity 0.3s ease'
                        }} 
                    />
                    
                    {/* Semi-transparent Download Overlay */}
                    <div style={{
                        position: 'absolute',
                        top: 0, left: 0, right: 0, bottom: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(0, 0, 0, 0.15)',
                        zIndex: 2
                    }}>
                        {isDownloading ? (
                            <div className="spinner-small" style={{ width: '28px', height: '28px' }} />
                        ) : downloadFailed ? (
                            <div style={{
                                background: 'rgba(234, 67, 53, 0.85)',
                                padding: '6px 12px',
                                borderRadius: '16px',
                                color: '#fff',
                                fontSize: '0.8rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                fontWeight: 600,
                                boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                            }}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                Expired
                            </div>
                        ) : (
                            <button
                                onClick={handleDownload}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: '24px',
                                    border: 'none',
                                    background: 'rgba(0, 0, 0, 0.5)',
                                    backdropFilter: 'blur(10px)',
                                    color: '#fff',
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    fontSize: '0.85rem',
                                    fontWeight: 600,
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                                    transition: 'background 0.2s, transform 0.1s'
                                }}
                                onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(0, 0, 0, 0.65)')}
                                onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(0, 0, 0, 0.5)')}
                                title="Download Video"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                                {fileSizeStr && <span style={{ whiteSpace: 'nowrap' }}>{fileSizeStr}</span>}
                            </button>
                        )}
                    </div>

                    {/* Glassmorphic Video Duration/Type Badge */}
                    <div style={{
                        position: 'absolute',
                        bottom: '8px',
                        left: '8px',
                        background: 'rgba(0, 0, 0, 0.6)',
                        backdropFilter: 'blur(8px)',
                        borderRadius: '6px',
                        padding: '3px 8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: '#fff',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        zIndex: 3,
                        pointerEvents: 'none',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                    }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                        <span>{duration ? formatDuration(duration) : 'Video'}</span>
                    </div>
                </div>
            )
        }

        return <DownloadMediaPlaceholder 
            label="Video" 
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="7" y1="3" x2="7" y2="10"/><line x1="17" y1="3" x2="17" y2="10"/><line x1="7" y1="10" x2="7" y2="17"/><line x1="17" y1="10" x2="17" y2="17"/></svg>}
            onDownload={handleDownload}
            isDownloading={isDownloading}
            downloadFailed={downloadFailed}
        />
    }

    return (
        <div className="message-video" style={{ 
            marginBottom: textContent ? '8px' : '0',
            borderRadius: '12px',
            overflow: 'hidden',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            background: '#000',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            width: `${dispWidth}px`,
            height: `${dispHeight}px`,
            position: 'relative'
        }}>
            <video 
                src={localURI} 
                controls 
                poster={thumbnailData}
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} 
            />
        </div>
    )
}

export const DocumentMessage = ({ localURI, textContent, rawMsg, onDownload, isDownloading }: any) => {
    const doc = rawMsg?.documentMessage || {}
    const fileName = doc.fileName || 'Document'
    const fileSize = doc.fileLength ? (Number(doc.fileLength) / 1024 / 1024).toFixed(2) + ' MB' : ''

    const handleOpen = () => {
        if (localURI) api.openFile(localURI)
    }

    return (
        <div className="message-document" style={{
            padding: '12px',
            borderRadius: '10px',
            background: 'rgba(0,0,0,0.04)',
            border: '1px solid rgba(0,0,0,0.08)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            minWidth: '220px',
            maxWidth: '320px',
            marginBottom: textContent ? '8px' : '0'
        }}>
            <div style={{
                width: '44px',
                height: '44px',
                borderRadius: '8px',
                background: 'var(--primary, #00a884)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: '12px'
            }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14.5 2 14.5 7.5 20 7.5"/></svg>
            </div>
            
            <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ 
                    fontSize: '0.9rem', 
                    fontWeight: 600, 
                    whiteSpace: 'nowrap', 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis',
                    color: '#333'
                }} title={fileName}>
                    {fileName}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#777', marginTop: '2px' }}>
                    {fileSize} • {doc.mimetype?.split('/')[1]?.toUpperCase() || 'FILE'}
                </div>
            </div>

            <button 
                onClick={localURI ? handleOpen : onDownload}
                disabled={isDownloading}
                style={{
                    background: 'none',
                    border: 'none',
                    padding: '8px',
                    cursor: 'pointer',
                    color: 'var(--primary, #00a884)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}
            >
                {isDownloading ? (
                    <div className="spinner-small" style={{ width: '16px', height: '16px' }} />
                ) : localURI ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
                ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                )}
            </button>
        </div>
    )
}
