interface AIChatOptions {
  useThinkMode: boolean;
  model: string;
}

interface AISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  options: AIChatOptions;
  onOptionsChange: (newOptions: AIChatOptions) => void;
}

export default function AISettingsModal({ isOpen, onClose, options, onOptionsChange }: AISettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div 
      className="ai-settings-overlay" 
      onClick={onClose} 
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, 
        backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 100, 
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      <div 
        className="ai-settings-modal" 
        onClick={e => e.stopPropagation()} 
        style={{
          backgroundColor: 'var(--wa-sidebar-bg)', 
          padding: '24px', 
          borderRadius: '12px', 
          minWidth: '280px', 
          border: '1px solid var(--wa-border)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
        }}
      >
        <h3 style={{ color: 'white', margin: '0 0 20px 0', fontSize: '18px', fontWeight: '600' }}>AI Preferences</h3>
        
        <div style={{ margin: '15px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--wa-text-primary)', fontSize: '14px' }}>Thinking Mode (ReAct)</span>
          <input 
            type="checkbox" 
            checked={options.useThinkMode} 
            onChange={(e) => onOptionsChange({ ...options, useThinkMode: e.target.checked })}
            style={{ cursor: 'pointer', width: '18px', height: '18px' }}
          />
        </div>

        <div style={{ margin: '20px 0 15px 0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ color: 'var(--wa-text-primary)', fontSize: '14px' }}>Model Selection</span>
          <select 
            value={options.model} 
            onChange={(e) => onOptionsChange({ ...options, model: e.target.value })}
            style={{ 
              padding: '10px 8px', 
              backgroundColor: 'var(--wa-header-bg)', 
              color: 'white', 
              border: '1px solid var(--wa-border)', 
              borderRadius: '6px',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite</option>
            <option value="gemma-4-31b-it">Gemma 4 31B IT</option>
            <option value="gemma-3-27b-it">Gemma 3 27B IT</option>
            <option value="gemini-3-flash-preview">Gemini 3 Flash Preview</option>
            <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</option>
          </select>
        </div>

        <button 
          onClick={onClose} 
          style={{
            marginTop: '20px', 
            width: '100%', 
            padding: '10px', 
            backgroundColor: 'var(--wa-primary)', 
            color: 'white', 
            border: 'none', 
            borderRadius: '6px', 
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '14px'
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
