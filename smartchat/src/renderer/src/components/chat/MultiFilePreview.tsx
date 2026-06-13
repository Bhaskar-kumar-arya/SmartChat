import { X, Plus, Send, File } from 'lucide-react'
import { StagedFile } from '../../hooks/useMultiFileQueue'

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp']
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm']

const isImageFile = (ext: string) => IMAGE_EXTENSIONS.includes(ext.toLowerCase())
const isVideoFile = (ext: string) => VIDEO_EXTENSIONS.includes(ext.toLowerCase())

interface MultiFilePreviewProps {
  files: StagedFile[]
  selectedIndex: number
  onSelectFile: (index: number) => void
  onRemoveFile: (index: number) => void
  onAddMore: () => void
  onCaptionChange: (index: number, text: string) => void
  onSend: () => void
  onClose: () => void
  sending: boolean
}

export default function MultiFilePreview({
  files,
  selectedIndex,
  onSelectFile,
  onRemoveFile,
  onAddMore,
  onCaptionChange,
  onSend,
  onClose,
  sending,
}: MultiFilePreviewProps) {
  if (files.length === 0) return null

  const selectedFile = files[selectedIndex] || files[0]
  if (!selectedFile) return null

  const ext = selectedFile.ext
  const isImage = isImageFile(ext)
  const isVideo = isVideoFile(ext)
  // Convert Windows backslashes and encode each segment, but keep slashes intact
  const toLocalUrl = (p: string) =>
    'app://local/' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
  const localUrl = toLocalUrl(selectedFile.path)

  return (
    <div className="multi-file-preview-overlay">
      <div className="multi-file-preview-container">
        {/* Header */}
        <div className="mfp-header">
          <button className="mfp-close-btn" onClick={onClose} disabled={sending} title="Cancel">
            <X size={24} />
          </button>
          <span className="mfp-title">Preview attachments ({files.length})</span>
        </div>

        {/* Main large preview area */}
        <div className="mfp-preview-area">
          {isImage ? (
            <img src={localUrl} alt={selectedFile.name} className="mfp-preview-media" />
          ) : isVideo ? (
            <video src={localUrl} controls className="mfp-preview-media" />
          ) : (
            <div className="mfp-preview-doc-card">
              <File size={64} className="mfp-doc-icon" />
              <span className="mfp-doc-name">{selectedFile.name}</span>
              <span className="mfp-doc-size">Document attachment</span>
            </div>
          )}
        </div>

        {/* Middle thumbnail tray */}
        <div className="mfp-tray-section">
          <div className="mfp-thumbnail-tray">
            {files.map((file, index) => {
              const fileExt = file.ext
              const fileIsImage = isImageFile(fileExt)
              const fileIsVideo = isVideoFile(fileExt)
              const fileLocalUrl = toLocalUrl(file.path)
              const isSelected = index === selectedIndex

              return (
                <div
                  key={file.path}
                  className={`mfp-thumbnail-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => onSelectFile(index)}
                >
                  {fileIsImage ? (
                    <img src={fileLocalUrl} alt={file.name} className="mfp-thumb-media" />
                  ) : fileIsVideo ? (
                    <video src={fileLocalUrl} className="mfp-thumb-media" muted playsInline />
                  ) : (
                    <div className="mfp-thumb-doc">
                      <File size={20} />
                      <span className="mfp-thumb-ext">{fileExt || 'file'}</span>
                    </div>
                  )}
                  <button
                    className="mfp-thumb-remove"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveFile(index)
                    }}
                    disabled={sending}
                  >
                    <X size={12} />
                  </button>
                </div>
              )
            })}

            {/* Add More Button */}
            {files.length < 30 && (
              <button
                className="mfp-add-more-btn"
                onClick={onAddMore}
                disabled={sending}
                title="Add more files"
              >
                <Plus size={24} />
              </button>
            )}
          </div>
        </div>

        {/* Footer: Per-file caption and send button */}
        <div className="mfp-footer">
          <input
            type="text"
            className="mfp-caption-input"
            placeholder={`Add a caption for ${selectedFile.name}...`}
            value={selectedFile.caption}
            onChange={(e) => onCaptionChange(selectedIndex, e.target.value)}
            disabled={sending}
            autoFocus
          />

          <button className="mfp-send-btn" onClick={onSend} disabled={sending} title="Send all">
            {sending ? (
              <span className="mfp-sending-spinner" />
            ) : (
              <>
                <Send size={20} />
                <span className="mfp-send-badge">{files.length}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
