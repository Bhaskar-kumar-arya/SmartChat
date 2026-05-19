import { useState, useEffect } from 'react';
import { AIChatOptions, ModelInfo } from '../types';

interface AISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  options: AIChatOptions;
  onOptionsChange: (newOptions: AIChatOptions) => void;
  availableModels: ModelInfo[];
}

export default function AISettingsModal({ isOpen, onClose, options, onOptionsChange, availableModels }: AISettingsModalProps) {
  const [selectedProvider, setSelectedProvider] = useState<'gemini' | 'lmstudio' | 'groq' | 'mistral' | 'deepseek'>('gemini');
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpenDropdown, setIsOpenDropdown] = useState(false);
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({ gemini: '', groq: '', mistral: '', deepseek: '' });
  const [showKey, setShowKey] = useState(false);

  // Load persisted keys when settings modal opens
  useEffect(() => {
    if (isOpen) {
      window.api.getProviderKeys().then(setProviderKeys).catch(console.error);
    }
  }, [isOpen]);

  // Keep selected provider in sync with active model option
  useEffect(() => {
    const model = availableModels.find(m => m.id === options.model);
    if (model) {
      setSelectedProvider(model.provider);
    } else if (options.model.startsWith('groq:')) {
      setSelectedProvider('groq');
    } else if (options.model.startsWith('mistral:')) {
      setSelectedProvider('mistral');
    } else if (options.model.startsWith('deepseek:')) {
      setSelectedProvider('deepseek');
    }
  }, [options.model, availableModels]);

  // Close dropdown on clicking outside
  useEffect(() => {
    if (!isOpenDropdown) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.custom-dropdown-container')) {
        setIsOpenDropdown(false);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [isOpenDropdown]);

  if (!isOpen) return null;

  const handleProviderChange = (newProvider: 'gemini' | 'lmstudio' | 'groq' | 'mistral' | 'deepseek') => {
    setSelectedProvider(newProvider);
    setSearchQuery('');
    setIsOpenDropdown(false);
    const firstModel = availableModels.find(m => m.provider === newProvider);
    if (firstModel) {
      onOptionsChange({ ...options, model: firstModel.id });
    }
  };

  const filteredModels = availableModels
    .filter(m => m.provider === selectedProvider)
    .filter(m => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return m.name.toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q);
    });

  return (
    <div className="ai-modal-overlay" onClick={onClose}>
      <div className="ai-modal-container" onClick={e => e.stopPropagation()}>
        <div className="ai-modal-header" style={{ marginBottom: '20px' }}>
          <h3>AI Preferences</h3>
        </div>
        
        <div className="ai-settings-scroll-content">
          <div className="ai-settings-row">
          <span className="ai-settings-label">Thinking Mode (ReAct)</span>
          <input 
            type="checkbox" 
            className="ai-settings-checkbox"
            checked={options.useThinkMode} 
            onChange={(e) => onOptionsChange({ ...options, useThinkMode: e.target.checked })}
          />
        </div>

        <div className="ai-settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px', margin: '20px 0 12px 0' }}>
          <span className="ai-settings-label">AI Provider</span>
          <select 
            className="ai-settings-select"
            style={{ width: '100%', maxWidth: 'none' }}
            value={selectedProvider} 
            onChange={(e) => handleProviderChange(e.target.value as any)}
          >
            <option value="gemini">☁️ Google Gemini (Cloud)</option>
            <option value="groq">⚡ Groq Cloud (High-speed Llama & Mixtral)</option>
            <option value="mistral">🌀 Mistral AI (Codestral & Large)</option>
            <option value="deepseek">🐳 DeepSeek AI (V4 & Reasoner)</option>
            <option value="lmstudio">🖥️ LM Studio (Local & Offline)</option>
          </select>
        </div>

        {selectedProvider !== 'lmstudio' && (
          <div className="ai-settings-key-container">
            <div className="ai-settings-key-header">
              <span className="ai-settings-label" style={{ textTransform: 'capitalize' }}>
                🔑 {selectedProvider} API Key
              </span>
              <button 
                type="button"
                className="ai-settings-key-toggle-btn"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? 'Hide Key' : 'Show Key'}
              </button>
            </div>
            <input 
              type={showKey ? 'text' : 'password'}
              className="ai-settings-key-input"
              placeholder={`Enter custom ${selectedProvider} API key...`}
              value={providerKeys[selectedProvider] || ''}
              onChange={async (e) => {
                const val = e.target.value;
                setProviderKeys(prev => ({ ...prev, [selectedProvider]: val }));
                await window.api.setProviderKey(selectedProvider, val);
              }}
            />
            <span className="ai-settings-key-caption">
              Auto-saves on change. Uses built-in fallbacks if left empty.
            </span>
          </div>
        )}

        <div className="ai-settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px', margin: '0 0 15px 0' }}>
          <span className="ai-settings-label">Model Selection</span>
          <div className="custom-dropdown-container" style={{ position: 'relative', width: '100%' }}>
            <div 
              onClick={() => setIsOpenDropdown(!isOpenDropdown)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--wa-border, rgba(0,0,0,0.15))',
                backgroundColor: 'var(--wa-bg-secondary, #f0f2f5)',
                cursor: 'pointer',
                fontSize: '13px',
                minHeight: '38px',
                userSelect: 'none',
                color: 'var(--wa-text-primary, #000)'
              }}
            >
              <span>{availableModels.find(m => m.id === options.model)?.name || options.model}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: isOpenDropdown ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}>
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>

            {isOpenDropdown && (
              <div 
                style={{
                  position: 'absolute',
                  top: '105%',
                  left: 0,
                  right: 0,
                  zIndex: 1000,
                  backgroundColor: 'var(--wa-bg-main, #ffffff)',
                  border: '1px solid var(--wa-border, rgba(0,0,0,0.15))',
                  borderRadius: '8px',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                  padding: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  maxHeight: '260px',
                }}
              >
                <input 
                  type="text"
                  autoFocus
                  placeholder="Search models..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--wa-border, rgba(0,0,0,0.15))',
                    backgroundColor: 'var(--wa-bg-secondary, #f0f2f5)',
                    color: 'var(--wa-text-primary, #000)',
                    outline: 'none',
                    fontSize: '12px'
                  }}
                />
                <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '180px' }}>
                  {filteredModels.length === 0 ? (
                    <div style={{ padding: '12px', fontSize: '12px', color: 'var(--wa-text-secondary, #666)', textAlign: 'center' }}>
                      No models found
                    </div>
                  ) : (
                    filteredModels.map(m => (
                      <div
                        key={m.id}
                        onClick={() => {
                          onOptionsChange({ ...options, model: m.id });
                          setIsOpenDropdown(false);
                          setSearchQuery('');
                        }}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          backgroundColor: options.model === m.id ? 'var(--wa-bg-secondary, #e4e6eb)' : 'transparent',
                          fontWeight: options.model === m.id ? 'bold' : 'normal',
                          color: 'var(--wa-text-primary, #000)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px',
                          transition: 'background-color 0.15s ease',
                          textAlign: 'left'
                        }}
                        onMouseEnter={(e) => {
                          if (options.model !== m.id) {
                            e.currentTarget.style.backgroundColor = 'var(--wa-bg-secondary, #f0f2f5)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (options.model !== m.id) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }
                        }}
                      >
                        <span style={{ fontWeight: '500' }}>{m.name}</span>
                        {m.description && (
                          <span style={{ fontSize: '10px', color: 'var(--wa-text-secondary, #666)', opacity: 0.8 }}>
                            {m.description}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          {availableModels.find(m => m.id === options.model)?.description && !isOpenDropdown && (
            <span style={{ fontSize: '11px', color: 'var(--wa-primary)', opacity: 0.8, marginTop: '4px' }}>
              {availableModels.find(m => m.id === options.model)?.description}
            </span>
          )}
        </div>

        {selectedProvider === 'lmstudio' && (
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
        )}

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
        </div>

        <button className="ai-settings-save-btn" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
