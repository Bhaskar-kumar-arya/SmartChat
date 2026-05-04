import { AIChatOptions, ModelInfo } from '../types';

interface AISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  options: AIChatOptions;
  onOptionsChange: (newOptions: AIChatOptions) => void;
  availableModels: ModelInfo[];
}

export default function AISettingsModal({ isOpen, onClose, options, onOptionsChange, availableModels }: AISettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="ai-modal-overlay" onClick={onClose}>
      <div className="ai-modal-container" onClick={e => e.stopPropagation()}>
        <div className="ai-modal-header" style={{ marginBottom: '20px' }}>
          <h3>AI Preferences</h3>
        </div>
        
        <div className="ai-settings-row">
          <span className="ai-settings-label">Thinking Mode (ReAct)</span>
          <input 
            type="checkbox" 
            className="ai-settings-checkbox"
            checked={options.useThinkMode} 
            onChange={(e) => onOptionsChange({ ...options, useThinkMode: e.target.checked })}
          />
        </div>

        <div className="ai-settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px', margin: '20px 0 15px 0' }}>
          <span className="ai-settings-label">Model Selection</span>
          <select 
            className="ai-settings-select"
            style={{ width: '100%', maxWidth: 'none' }}
            value={options.model} 
            onChange={(e) => onOptionsChange({ ...options, model: e.target.value })}
          >
            {availableModels.length === 0 && (
              <option value={options.model}>{options.model} (Loading...)</option>
            )}
            
            <optgroup label="Remote (Gemini)">
               {availableModels.filter(m => m.provider === 'gemini').map(m => (
                 <option key={m.id} value={m.id}>{m.name}</option>
               ))}
            </optgroup>

            {availableModels.some(m => m.provider === 'lmstudio') && (
              <optgroup label="Local (LM Studio)">
                {availableModels.filter(m => m.provider === 'lmstudio').map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </optgroup>
            )}
          </select>
          {availableModels.find(m => m.id === options.model)?.description && (
            <span style={{ fontSize: '11px', color: 'var(--wa-primary)', opacity: 0.8 }}>
              {availableModels.find(m => m.id === options.model)?.description}
            </span>
          )}
        </div>

        <div className="ai-settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="ai-settings-label">Context Size</span>
            <span style={{ color: 'var(--wa-primary)', fontSize: '12px', fontWeight: '600' }}>{options.contextLength} tokens</span>
          </div>
          <input 
            type="range" 
            min="2048" 
            max="128000" 
            step="2048"
            value={options.contextLength} 
            onChange={(e) => onOptionsChange({ ...options, contextLength: parseInt(e.target.value) })}
            style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--wa-primary)' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--wa-text-secondary)' }}>
            <span>2K</span>
            <span>128K</span>
          </div>
        </div>

        <div className="ai-settings-row">
          <span className="ai-settings-label">Store Chat History</span>
          <input 
            type="checkbox" 
            className="ai-settings-checkbox"
            checked={options.autoSaveChats} 
            onChange={(e) => {
              const checked = e.target.checked;
              onOptionsChange({ ...options, autoSaveChats: checked });
              window.api.setAiAutoSave(checked);
            }}
          />
        </div>

        <button className="ai-settings-save-btn" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
