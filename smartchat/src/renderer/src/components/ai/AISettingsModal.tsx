import { useState, useEffect, useRef } from 'react';
import { AIChatOptions, ModelInfo } from '../../types/aiTypes';
import { useAPI } from '../../context/APIContext';

interface AISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  options: AIChatOptions;
  onOptionsChange: (newOptions: AIChatOptions) => void;
  availableModels: ModelInfo[];
}

export default function AISettingsModal({ isOpen, onClose, options, onOptionsChange, availableModels }: AISettingsModalProps) {
  const api = useAPI();
  const [selectedProvider, setSelectedProvider] = useState<'gemini' | 'lmstudio' | 'groq' | 'mistral' | 'deepseek'>('gemini');
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpenDropdown, setIsOpenDropdown] = useState(false);
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({ gemini: '', groq: '', mistral: '', deepseek: '' });
  const [showKey, setShowKey] = useState(false);
  // F8-06: the key input is now a local draft; it persists on blur, not per
  // keystroke. `loadedKeysRef` holds the values getProviderKeys returned (which
  // are MASKED, e.g. "••••ab12", per F1-02) so we only persist a genuine change
  // and never write the masked placeholder back.
  const loadedKeysRef = useRef<Record<string, string>>({});

  // Load persisted keys when settings modal opens
  useEffect(() => {
    if (isOpen) {
      api.getProviderKeys().then((keys) => {
        loadedKeysRef.current = { ...keys };
        setProviderKeys(keys);
      }).catch(console.error);
    }
  }, [isOpen]);

  const commitProviderKey = (provider: string, value: string) => {
    // Unchanged, or still the masked placeholder → nothing to persist.
    if (value === (loadedKeysRef.current[provider] ?? '')) return;
    if (value.includes('•')) return;
    loadedKeysRef.current[provider] = value;
    api.setProviderKey(provider, value).catch(console.error);
  };

  // Keep selected provider in sync with active model option
  useEffect(() => {
    const model = availableModels.find(m => m.id === options.model);
    if (model) {
      setSelectedProvider(model.provider as 'gemini' | 'lmstudio' | 'groq' | 'mistral' | 'deepseek');
    } else if (options.model.startsWith('groq:')) {
      setSelectedProvider('groq');
    } else if (options.model.startsWith('mistral:')) {
      setSelectedProvider('mistral');
    } else if (options.model.startsWith('deepseek:')) {
      setSelectedProvider('deepseek');
    } else if (options.model.startsWith('lmstudio:')) {
      setSelectedProvider('lmstudio');
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
        <div className="ai-modal-header">
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

          <div className="ai-settings-row provider-select">
            <span className="ai-settings-label">AI Provider</span>
            <select 
              className="ai-settings-select full-width"
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
                onChange={(e) => {
                  const val = e.target.value;
                  setProviderKeys(prev => ({ ...prev, [selectedProvider]: val }));
                }}
                onBlur={(e) => commitProviderKey(selectedProvider, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitProviderKey(selectedProvider, (e.target as HTMLInputElement).value);
                }}
              />
              <span className="ai-settings-key-caption">
                Saved when you leave the field. Uses built-in fallbacks if left empty.
              </span>
            </div>
          )}

          <div className="ai-settings-row model-select">
            <span className="ai-settings-label">Model Selection</span>
            <div className="custom-dropdown-container">
              <div 
                onClick={() => setIsOpenDropdown(!isOpenDropdown)}
                className={`custom-dropdown-trigger ${isOpenDropdown ? 'open' : ''}`}
              >
                <span>{availableModels.find(m => m.id === options.model)?.name || options.model}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>

              {isOpenDropdown && (
                <div className="custom-dropdown-menu">
                  <input 
                    type="text"
                    autoFocus
                    placeholder="Search models..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="custom-dropdown-search"
                  />
                  <div className="custom-dropdown-list">
                    {filteredModels.length === 0 ? (
                      <div className="custom-dropdown-empty">
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
                          className={`custom-dropdown-item ${options.model === m.id ? 'selected' : ''}`}
                        >
                          <span className="custom-dropdown-item-name">{m.name}</span>
                          {m.description && (
                            <span className="custom-dropdown-item-desc">
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
              <span className="ai-model-desc-caption">
                {availableModels.find(m => m.id === options.model)?.description}
              </span>
            )}
          </div>

          {selectedProvider === 'lmstudio' && (
            <div className="ai-settings-row slider-container">
              <div className="slider-header">
                <span className="ai-settings-label">Context Size</span>
                <span className="slider-value">{options.contextLength} tokens</span>
              </div>
              <input 
                type="range" 
                min="2048" 
                max="128000" 
                step="2048"
                value={options.contextLength} 
                onChange={(e) => onOptionsChange({ ...options, contextLength: parseInt(e.target.value) })}
                className="lmstudio-context-slider"
              />
              <div className="slider-labels">
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
                api.setAiAutoSave(checked);
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
