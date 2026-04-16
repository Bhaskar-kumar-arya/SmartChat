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
          minWidth: '320px', 
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
              cursor: 'pointer',
              fontSize: '13px'
            }}
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

        <div style={{ margin: '15px 0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--wa-text-primary)', fontSize: '14px' }}>Context Size</span>
            <span style={{ color: 'var(--wa-primary)', fontSize: '12px', fontWeight: '600' }}>{options.contextLength} tokens</span>
          </div>
          <input 
            type="range" 
            min="2048" 
            max="128000" 
            step="2048"
            value={options.contextLength} 
            onChange={(e) => onOptionsChange({ ...options, contextLength: parseInt(e.target.value) })}
            style={{ 
              width: '100%',
              cursor: 'pointer',
              accentColor: 'var(--wa-primary)'
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--wa-text-secondary)' }}>
            <span>2K</span>
            <span>128K</span>
          </div>
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
