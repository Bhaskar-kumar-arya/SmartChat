import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { ChatItem } from '../types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface AIChatMessage {
  id: string
  role: 'user' | 'ai'
  content: string
  contexts?: any[]
  isHidden?: boolean
  toolResult?: string
}

interface SelectedContext {
  jid: string
  name: string
}

interface AIChatSidebarProps {
  isOpen: boolean
  onClose: () => void
  width: number
}

export default function AIChatSidebar({ isOpen, onClose, width }: AIChatSidebarProps) {
  const [messages, setMessages] = useState<AIChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [executingToolId, setExecutingToolId] = useState<string | null>(null)
  
  const [showMentionMenu, setShowMentionMenu] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [chatList, setChatList] = useState<ChatItem[]>([])
  const [filteredChats, setFilteredChats] = useState<ChatItem[]>([])
  
  const [contexts, setContexts] = useState<SelectedContext[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  
  const streamingBuffers = useRef<Record<string, string>>({})
  const typingInterval = useRef<any>(null)

  useEffect(() => {
    return () => {
      if (typingInterval.current) clearInterval(typingInterval.current);
    }
  }, [])

  useEffect(() => {
    if (isOpen && chatList.length === 0) {
      window.api.getChats(1, 100).then(setChatList).catch(console.error)
    }
  }, [isOpen])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, loading])

  useEffect(() => {
    if (mentionQuery) {
      setFilteredChats(
        chatList.filter(c => {
          const dn = c.name || c.jid.split('@')[0] || '';
          return dn.toLowerCase().includes(mentionQuery.toLowerCase());
        })
      )
    } else {
      setFilteredChats(chatList.slice(0, 10))
    }
  }, [mentionQuery, chatList])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInputValue(val)

    const lastAtPos = val.lastIndexOf('@')
    if (lastAtPos !== -1) {
      const textAfterAt = val.slice(lastAtPos + 1)
      if (!textAfterAt.includes(' ')) {
        setShowMentionMenu(true)
        setMentionQuery(textAfterAt)
        return
      }
    }
    setShowMentionMenu(false)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !showMentionMenu) {
      handleSend()
    }
  }

  const selectContext = (chat: ChatItem) => {
    if (!contexts.find(c => c.jid === chat.jid)) {
      setContexts([...contexts, { jid: chat.jid, name: chat.name }])
    }
    const lastAtPos = inputValue.lastIndexOf('@')
    if (lastAtPos !== -1) {
      setInputValue(inputValue.slice(0, lastAtPos) + `@${chat.name} `)
    }
    setShowMentionMenu(false)
    
    // Restore focus and move cursor to the end
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const length = inputRef.current.value.length;
        inputRef.current.setSelectionRange(length, length);
      }
    }, 0);
  }

  const removeContext = (jid: string) => {
    setContexts(contexts.filter(c => c.jid !== jid))
  }

  const declineToolCall = (messageId: string) => {
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, toolResult: "User declined tool execution." } : m));
  }

  const executeToolCall = async (messageId: string, toolName: string, args: any) => {
    setExecutingToolId(messageId);
    let resultPayload = '';
    try {
      const result = await window.api.executeTool(toolName, args);
      resultPayload = JSON.stringify(result, null, 2);
    } catch (err: any) {
      resultPayload = JSON.stringify({ error: err.message || String(err) });
    }
    
    setExecutingToolId(null);
    const sysMsgId = crypto.randomUUID();
    const aiMsgId = crypto.randomUUID();
    let historyToPass: AIChatMessage[] = [];
    
    setMessages(prev => {
        const updated = prev.map(m => m.id === messageId ? { ...m, toolResult: resultPayload } : m);
        historyToPass = [...updated, {
            id: sysMsgId,
            role: 'user' as const,
            content: `Tool Execution Result:\n\`\`\`json\n${resultPayload}\n\`\`\`\nContinue your response.`,
            isHidden: true
        }];
        
        return [...historyToPass, {
            id: aiMsgId,
            role: 'ai' as const,
            content: ''
        }];
    });

    // START SIDE EFFECTS OUTSIDE REACT UPDATER
    streamingBuffers.current[aiMsgId] = '';
    setLoading(true);

    const ensureDripper = () => {
      if (!typingInterval.current) {
        typingInterval.current = setInterval(() => {
          let hasWork = false;
          const updates: Record<string, string> = {};
          for (const key in streamingBuffers.current) {
             const buffer = streamingBuffers.current[key];
             if (buffer && buffer.length > 0) {
                hasWork = true;
                const charsToTake = Math.max(2, Math.ceil(buffer.length / 8)); 
                updates[key] = buffer.substring(0, charsToTake);
                streamingBuffers.current[key] = buffer.substring(charsToTake);
             }
          }
          if (!hasWork) {
             clearInterval(typingInterval.current);
             typingInterval.current = null;
             return;
          }
          setMessages(p => p.map(m => updates[m.id] ? { ...m, content: m.content + updates[m.id] } : m));
        }, 30);
      }
    };

    window.api.aiChatStream(
        `Tool Execution Result:\n\`\`\`json\n${resultPayload}\n\`\`\`\n\nThe tool executed successfully. Continue your response by summarizing the action to the user seamlessly.`, 
        [], 
        historyToPass.filter(m => !m.isHidden),
        (chunk) => {
           setLoading(false);
           if (streamingBuffers.current[aiMsgId] === undefined) streamingBuffers.current[aiMsgId] = '';
           streamingBuffers.current[aiMsgId] += chunk;
           ensureDripper();
        },
        () => {
           setLoading(false);
           const remainder = streamingBuffers.current[aiMsgId];
           delete streamingBuffers.current[aiMsgId];
           if (remainder && remainder.length > 0) {
              setMessages(p => p.map(m => m.id === aiMsgId ? { ...m, content: m.content + remainder } : m));
           }
        },
        (err) => {
           setLoading(false);
           delete streamingBuffers.current[aiMsgId];
           setMessages(p => p.map(m => m.id === aiMsgId ? { ...m, content: m.content + '\n\n**Error:** ' + String(err) } : m));
        }
    );
  }

  const handleSend = async () => {
    if (!inputValue.trim() && contexts.length === 0) return
    
    const prompt = inputValue.trim()
    const currentContexts = [...contexts]
    
    setInputValue('')
    setContexts([])
    setShowMentionMenu(false)

    setLoading(true)

    try {
      // Resolve contexts
      const resolvedContexts: any[] = []
      for (const ctx of currentContexts) {
        const msgs = await window.api.getChatContext(ctx.jid)
        resolvedContexts.push({ jid: ctx.jid, name: ctx.name, messages: msgs })
      }

      // Generate unique IDs synchronously
      const userMessageId = crypto.randomUUID();
      const aiMessageId = crypto.randomUUID();

      // Add both messages atomically
      setMessages(prev => [...prev, 
        {
          id: userMessageId,
          role: 'user',
          content: prompt,
          contexts: resolvedContexts
        },
        {
          id: aiMessageId,
          role: 'ai',
          content: ''
        }
      ]);

      streamingBuffers.current[aiMessageId] = '';

      const ensureDripper = () => {
        if (!typingInterval.current) {
          typingInterval.current = setInterval(() => {
            let hasWork = false;
            const updates: Record<string, string> = {};
            
            // Calculate and perform mutations safely OUTSIDE the React state setter
            for (const key in streamingBuffers.current) {
               const buffer = streamingBuffers.current[key];
               if (buffer && buffer.length > 0) {
                  hasWork = true;
                  const charsToTake = Math.max(2, Math.ceil(buffer.length / 8)); 
                  const chars = buffer.substring(0, charsToTake);
                  updates[key] = chars;
                  streamingBuffers.current[key] = buffer.substring(charsToTake);
               }
            }
            
            if (!hasWork) {
               clearInterval(typingInterval.current);
               typingInterval.current = null;
               return;
            }

            // Pure state update lambda
            setMessages(prev => prev.map(m => {
               if (updates[m.id]) {
                  return { ...m, content: m.content + updates[m.id] };
               }
               return m;
            }));
          }, 30);
        }
      };

      window.api.aiChatStream(
        prompt, 
        resolvedContexts, 
        messages,
        (chunk) => {
          setLoading(false); // hide loader on first chunk
          if (streamingBuffers.current[aiMessageId] === undefined) streamingBuffers.current[aiMessageId] = '';
          streamingBuffers.current[aiMessageId] += chunk;
          ensureDripper();
        },
        () => {
          setLoading(false);
          // Dump the rest of the stream instantly when the response fully completes
          // Must extract and delete outside setMessages to survive React 18 Strict Mode double-invocation
          const remainder = streamingBuffers.current[aiMessageId];
          delete streamingBuffers.current[aiMessageId];

          if (remainder && remainder.length > 0) {
            setMessages(prev => prev.map(m => 
               m.id === aiMessageId ? { ...m, content: m.content + remainder } : m
            ));
          }
        },
        (error) => {
          console.error(error);
          setLoading(false);
          delete streamingBuffers.current[aiMessageId];
          setMessages(prev => prev.map(m => 
            m.id === aiMessageId ? { ...m, content: m.content + '\n\n**Error:** Failed to generate response.' } : m
          ));
        }
      );

    } catch (error) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: 'Sorry, I encountered an error. Please check the console.'
      }])
      console.error(error)
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="ai-sidebar" style={{ width: `${width}px` }}>
      <div className="ai-header">
        <div className="ai-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a10 10 0 1 0 10 10H12V2z"></path>
            <path d="M12 12 2.1 14.9a10 10 0 0 0 19.8 0L12 12z"></path>
          </svg>
          <h3>AI Assistant</h3>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            className="ai-close-btn" 
            onClick={() => { setMessages([]); setContexts([]) }} 
            title="Clear Chat"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
          <button className="ai-close-btn" onClick={onClose} title="Close Sidebar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      <div className="ai-messages">
        {messages.length === 0 ? (
          <div className="ai-empty-state">
            <p>How can I help you today?</p>
            <span>Type @ to include chat context.</span>
          </div>
        ) : (
          messages.filter(m => !m.isHidden).map(msg => {
            const toolMatch = msg.content.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
            let toolData: any = null;
            if (toolMatch) {
              try { toolData = JSON.parse(toolMatch[1]); } catch(e) {}
            }
            return (
              <div key={msg.id} className={`ai-message-bubble ${msg.role}`}>
                <div className="ai-message-content markdown-body">
                  {toolData ? (
                    <div className="ai-tool-card" style={{ padding: '12px', background: 'rgba(0,0,0,0.15)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <div style={{ fontWeight: 600, marginBottom: '8px', color: '#ffb340' }}>⚡ Tool Request: {toolData.tool}</div>
                      <pre style={{ fontSize: '11px', background: 'rgba(0,0,0,0.4)', padding: '8px', borderRadius: '4px', overflowX: 'auto', margin: 0 }}>
                        {JSON.stringify(toolData.arguments, null, 2)}
                      </pre>
                      {msg.toolResult ? (
                        <div style={{ marginTop: '10px', fontSize: '12px', color: '#a8bbd9', background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '4px' }}>
                          <span style={{fontWeight: 600}}>Result:</span> <pre style={{margin: 0, marginTop:'4px', whiteSpace: 'pre-wrap'}}>{msg.toolResult}</pre>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                          <button 
                            disabled={executingToolId === msg.id}
                            onClick={() => executeToolCall(msg.id, toolData.tool, toolData.arguments)}
                            style={{ flex: 1, padding: '6px 12px', border: 'none', background: '#0a84ff', color: 'white', borderRadius: '6px', cursor: executingToolId === msg.id ? 'not-allowed' : 'pointer', fontWeight: 600 }}
                          >
                            {executingToolId === msg.id ? 'Running...' : 'Approve'}
                          </button>
                          <button 
                            disabled={executingToolId === msg.id}
                            onClick={() => declineToolCall(msg.id)}
                            style={{ flex: 1, padding: '6px 12px', background: 'transparent', color: '#ff453a', border: '1px solid #ff453a', borderRadius: '6px', cursor: executingToolId === msg.id ? 'not-allowed' : 'pointer', fontWeight: 600 }}
                          >
                            Decline
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  )}
                </div>
              </div>
            )
          })
        )}
        {loading && (
          <div className="ai-message-bubble ai loading">
            <div className="typing-indicator">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="ai-input-wrapper">
        {contexts.length > 0 && (
          <div className="ai-context-list">
            {contexts.map(c => (
              <div key={c.jid} className="ai-context-chip">
                <span>@{c.name}</span>
                <button onClick={() => removeContext(c.jid)}>x</button>
              </div>
            ))}
          </div>
        )}
        
        {showMentionMenu && filteredChats.length > 0 && (
          <div className="ai-mention-menu">
            {filteredChats.map(chat => {
              const displayName = chat.name || chat.jid.split('@')[0] || '??';
              return (
              <div key={chat.jid} className="ai-mention-item" onClick={() => selectContext({ ...chat, name: displayName })}>
                {chat.profilePictureUrl ? (
                  <img src={chat.profilePictureUrl} alt="" className="ai-mention-pic" />
                ) : (
                  <div className="ai-mention-pic-placeholder">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <span>{displayName}</span>
              </div>
            )})}
          </div>
        )}

        <div className="ai-input-box">
          <input 
            ref={inputRef}
            type="text" 
            placeholder="Ask AI... (Type @ to attach chat)" 
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
          />
          <button className="ai-send-btn" onClick={handleSend} disabled={loading}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
