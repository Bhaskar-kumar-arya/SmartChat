import React, { useEffect, useState } from 'react'
import { api } from '../../../services/api.service'
import { JPEGThumbnail, ImageMessageProps, StickerMessageProps, VideoMessageProps, DocumentMessageProps, isJPEGThumbnailBuffer } from '../../../types'
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
    icon: React.ReactNode
    downloadFailed?: boolean
}

/**
 * Common layout for media that is not yet downloaded.
 */
export const DownloadMediaPlaceholder = ({ onDownload, isDownloading, label, icon, downloadFailed }: MediaMessageProps) => {
    return (
        <div className="message-image-download">
            {isDownloading ? (
                <div className="spinner-small" style={{ margin: '8px' }} />
            ) : downloadFailed ? (
                <div className="media-expired-wrapper">
                    <div className="media-expired-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                    </div>
                    <span>{label} Expired</span>
                </div>
            ) : (
                <div className="media-download-placeholder-info">
                    <div className="media-download-placeholder-icon">
                        {icon}
                    </div>
                    <button
                        onClick={onDownload}
                        className="media-download-placeholder-btn"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
                        Download {label}
                    </button>
                </div>
            )}
        </div>
    )
}

export const ImageMessage = ({ localURI, textContent, rawMsg, onDownload, isDownloading }: ImageMessageProps) => {
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
                    width: `${dispWidth}px`,
                    height: `${dispHeight}px`
                }}>
                    {/* Blurred Thumbnail Background */}
                    <img
                        src={thumbnailData}
                        alt="Preview"
                    />

                    {/* Semi-transparent Download Overlay */}
                    <div className="media-download-overlay">
                        {isDownloading ? (
                            <div className="spinner-small" style={{ width: '28px', height: '28px' }} />
                        ) : downloadFailed ? (
                            <div className="media-expired-badge">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                                Expired
                            </div>
                        ) : (
                            <button
                                onClick={handleDownload}
                                className="media-download-btn"
                                title="Download Image"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
                                {fileSizeStr && <span style={{ whiteSpace: 'nowrap' }}>{fileSizeStr}</span>}
                            </button>
                        )}
                    </div>
                </div>
            )
        }

        return <DownloadMediaPlaceholder
            label="Image"
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>}
            onDownload={handleDownload}
            isDownloading={isDownloading}
            downloadFailed={downloadFailed}
        />
    }

    return (
        <div className="message-image" style={{
            marginBottom: textContent ? '8px' : '0',
            width: `${dispWidth}px`,
            height: `${dispHeight}px`
        }} onClick={() => api.openFile(localURI)}>
            <img src={localURI} alt="Media" />
        </div>
    )
}

export const StickerMessage = ({ localURI, rawMsg, onDownload, isDownloading }: StickerMessageProps) => {
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
                <div className="message-sticker-placeholder">
                    <div className="sticker-expired-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                    </div>
                    <span>Sticker Expired</span>
                </div>
            )
        }

        if (thumbnailData) {
            return (
                <div className="message-sticker-preview">
                    <img
                        src={thumbnailData}
                        alt="Preview"
                    />

                    <div className="media-download-overlay">
                        {isDownloading ? (
                            <div className="spinner-small" style={{ width: '24px', height: '24px' }} />
                        ) : (
                            <button
                                onClick={handleDownload}
                                className="sticker-download-btn"
                                title="Download Sticker"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
                            </button>
                        )}
                    </div>
                </div>
            )
        }

        return <DownloadMediaPlaceholder
            label="Sticker"
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>}
            onDownload={handleDownload}
            isDownloading={isDownloading}
            downloadFailed={downloadFailed}
        />
    }

    return (
        <div className="message-sticker">
            <img src={localURI} alt="Sticker" onClick={() => api.openFile(localURI)} />
        </div>
    )
}

const getThumbnailData = (media?: { jpegThumbnail?: JPEGThumbnail }) => {
    if (!media || !media.jpegThumbnail) return undefined
    const thumb = media.jpegThumbnail
    if (typeof thumb === 'string') {
        return thumb.startsWith('data:') ? thumb : `data:image/jpeg;base64,${thumb}`
    }
    if (isJPEGThumbnailBuffer(thumb)) {
        const uint8 = new Uint8Array(thumb.data)
        let binary = ''
        for (let i = 0; i < uint8.byteLength; i++) binary += String.fromCharCode(uint8[i])
        return `data:image/jpeg;base64,${window.btoa(binary)}`
    }
    return undefined
}

export const VideoMessage = ({ localURI, textContent, rawMsg, onDownload, isDownloading }: VideoMessageProps) => {
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
                    width: `${dispWidth}px`,
                    height: `${dispHeight}px`
                }}>
                    {/* Blurred Thumbnail Background */}
                    <img
                        src={thumbnailData}
                        alt="Preview"
                    />

                    {/* Semi-transparent Download Overlay */}
                    <div className="media-download-overlay">
                        {isDownloading ? (
                            <div className="spinner-small" style={{ width: '28px', height: '28px' }} />
                        ) : downloadFailed ? (
                            <div className="media-expired-badge">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                                Expired
                            </div>
                        ) : (
                            <button
                                onClick={handleDownload}
                                className="media-download-btn"
                                title="Download Video"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
                                {fileSizeStr && <span style={{ whiteSpace: 'nowrap' }}>{fileSizeStr}</span>}
                            </button>
                        )}
                    </div>

                    {/* Glassmorphic Video Duration/Type Badge */}
                    <div className="media-duration-badge">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                        <span>{duration ? formatDuration(duration) : 'Video'}</span>
                    </div>
                </div>
            )
        }

        return <DownloadMediaPlaceholder
            label="Video"
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="2" y1="10" x2="22" y2="10" /><line x1="7" y1="3" x2="7" y2="10" /><line x1="17" y1="3" x2="17" y2="10" /><line x1="7" y1="10" x2="7" y2="17" /><line x1="17" y1="10" x2="17" y2="17" /></svg>}
            onDownload={handleDownload}
            isDownloading={isDownloading}
            downloadFailed={downloadFailed}
        />
    }

    return (
        <div className="message-video" style={{
            marginBottom: textContent ? '8px' : '0',
            width: `${dispWidth}px`,
            height: `${dispHeight}px`
        }}>
            <video
                src={localURI}
                controls
                poster={thumbnailData}
            />
        </div>
    )
}

export const DocumentMessage = ({ localURI, textContent, rawMsg, onDownload, isDownloading }: DocumentMessageProps) => {
    const doc = rawMsg?.documentMessage || {}
    const fileName = doc.fileName || 'Document'
    const fileSize = doc.fileLength ? (Number(doc.fileLength) / 1024 / 1024).toFixed(2) + ' MB' : ''

    const handleOpen = () => {
        if (localURI) api.openFile(localURI)
    }

    return (
        <div className="message-document" style={{
            marginBottom: textContent ? '8px' : '0'
        }}>
            <div className="document-icon-wrapper">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14.5 2 14.5 7.5 20 7.5" /></svg>
            </div>

            <div className="document-info">
                <div className="document-name" title={fileName}>
                    {fileName}
                </div>
                <div className="document-meta">
                    {fileSize} • {doc.mimetype?.split('/')[1]?.toUpperCase() || 'FILE'}
                </div>
            </div>

            <button
                onClick={localURI ? handleOpen : onDownload}
                disabled={isDownloading}
                className="document-action-btn"
            >
                {isDownloading ? (
                    <div className="spinner-small" style={{ width: '16px', height: '16px' }} />
                ) : localURI ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" x2="21" y1="14" y2="3" /></svg>
                ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
                )}
            </button>
        </div>
    )
}
