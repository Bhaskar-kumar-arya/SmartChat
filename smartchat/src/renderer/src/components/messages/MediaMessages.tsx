import { api } from '../../services/api.service'

interface MediaMessageProps {
  localURI?: string
  textContent?: string | null
  mentions?: Record<string, string>
  onDownload: () => void
  isDownloading: boolean
  label: string
  icon: any
}

/**
 * Common layout for media that is not yet downloaded.
 */
export const DownloadMediaPlaceholder = ({ onDownload, isDownloading, label, icon }: MediaMessageProps) => {
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

export const ImageMessage = ({ localURI, textContent, onDownload, isDownloading }: any) => {
  if (!localURI) {
    return <DownloadMediaPlaceholder 
      label="Image" 
      icon={<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>}
      onDownload={onDownload}
      isDownloading={isDownloading}
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
      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.1)'
    }} onClick={() => api.openFile(localURI)}>
      <img src={localURI} alt="Media" style={{ maxWidth: '300px', maxHeight: '400px', objectFit: 'contain', display: 'block' }} />
    </div>
  )
}

export const StickerMessage = ({ localURI, onDownload, isDownloading }: any) => {
    if (!localURI) {
        return <DownloadMediaPlaceholder 
            label="Sticker" 
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>}
            onDownload={onDownload}
            isDownloading={isDownloading}
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
    if (!localURI) {
        return <DownloadMediaPlaceholder 
            label="Video" 
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="7" y1="3" x2="7" y2="10"/><line x1="17" y1="3" x2="17" y2="10"/><line x1="7" y1="10" x2="7" y2="17"/><line x1="17" y1="10" x2="17" y2="17"/></svg>}
            onDownload={onDownload}
            isDownloading={isDownloading}
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
            maxWidth: '400px',
            width: '100%',
            minWidth: '200px',
            position: 'relative'
        }}>
            <video 
                src={localURI} 
                controls 
                poster={getThumbnailData(rawMsg?.videoMessage)}
                style={{ width: '100%', maxWidth: '100%', maxHeight: '500px', display: 'block' }} 
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
