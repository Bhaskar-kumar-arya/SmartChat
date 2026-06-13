import { Upload } from 'lucide-react'

interface DragDropOverlayProps {
  isVisible: boolean
}

export default function DragDropOverlay({ isVisible }: DragDropOverlayProps) {
  if (!isVisible) return null

  return (
    <div className="drag-drop-overlay">
      <div className="drag-drop-overlay-content">
        <div className="drag-drop-overlay-icon-wrapper">
          <Upload size={48} className="drag-drop-overlay-icon" />
        </div>
        <h3>Drop files here</h3>
        <p>Add them as attachments to your messages</p>
      </div>
    </div>
  )
}
