import { useState, useRef, useEffect } from 'react'
import { ChatItem } from '../types'
import AISmartInput from './AISmartInput'
import AIMessageBubble from './AIMessageBubble'
import AISettingsModal from './AISettingsModal'



interface AIChatMessage {
  id: string
  role: 'user' | 'ai'
  content: string
  contexts?: any[]
  mentions?: any[]
  isHidden?: boolean
  isSystem?: boolean
  toolResult?: string
  hasError?: boolean
}




interface AIChatSidebarProps {
  isOpen: boolean
  onClose: () => void
  width: number
}

export default function AIChatSidebar({ isOpen, onClose, width }: AIChatSidebarProps) {
  const [messages, setMessages] = useState<AIChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [executingToolId, setExecutingToolId] = useState<string | null>(null)
  const [chatList, setChatList] = useState<ChatItem[]>([])
  const [availableTools, setAvailableTools] = useState<any[]>([])
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [aiOptions, setAiOptions] = useState({ useThinkMode: true, model: 'gemini-3.1-flash-lite-preview' })

  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  const streamingBuffers = useRef<Record<string, string>>({})
  const typingInterval = useRef<any>(null)




  useEffect(() => {
    return () => {
      if (typingInterval.current) clearInterval(typingInterval.current);
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      if (chatList.length === 0) {
        window.api.getChats(1, 100).then(setChatList).catch(console.error)
      }
      window.api.getAiTools().then(setAvailableTools).catch(console.error)
    }
  }, [isOpen])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, loading])

  const startAIStream = (prompt: string, history: AIChatMessage[], aiMsgId: string, context: any[] = [], mentions: any[] = [], isSystem: boolean = false) => {
    streamingBuffers.current[aiMsgId] = '';
    setLoading(true);

    const drip = () => {
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
        prompt, 
        context, 
        history,
        mentions,
        { ...aiOptions, isSystem },
        (chunk) => {
           setLoading(false);
           if (streamingBuffers.current[aiMsgId] === undefined) streamingBuffers.current[aiMsgId] = '';
           streamingBuffers.current[aiMsgId] += chunk;
           drip();
        },
        () => {
           setLoading(false);
           const remainder = streamingBuffers.current[aiMsgId];
           delete streamingBuffers.current[aiMsgId];
           
           let finalContent = '';
           setMessages(p => p.map(m => {
             if (m.id === aiMsgId) {
               finalContent = m.content + remainder;
               return { ...m, content: finalContent };
             }
             return m;
           }));

           // Check for auto-executable tool call
           setTimeout(() => {
             const toolMatch = finalContent.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
             if (toolMatch) {
               try {
                 const toolData = JSON.parse(toolMatch[1]);
                 const tool = availableTools.find(t => t.name === toolData.tool);
                 if (tool && tool.requiresPermission === false) {
                   executeToolCall(aiMsgId, toolData.tool, toolData.arguments);
                 }
               } catch (e) {
                 console.error('Failed to parse tool data for auto-exec:', e);
               }
             }
           }, 100);
        },
        (err) => {
           setLoading(false);
           delete streamingBuffers.current[aiMsgId];
           setMessages(p => p.map(m => m.id === aiMsgId ? { ...m, content: m.content + '\n\n**Error:** ' + String(err), hasError: true } : m));
        }
    );
  }

  const declineToolCall = (messageId: string) => {
    const resultPayload = "User declined tool execution.";
    const sysMsgId = crypto.randomUUID();
    const aiMsgId = crypto.randomUUID();
    let historyToPass: AIChatMessage[] = [];

    setMessages(prev => {
        const updated = prev.map(m => m.id === messageId ? { ...m, toolResult: resultPayload } : m);
        historyToPass = [...updated, {
            id: sysMsgId,
            role: 'user' as const,
            content: `Tool Execution Result: ${resultPayload}`,
            isHidden: true,
            isSystem: true
        }];
        
        return [...historyToPass, {
            id: aiMsgId,
            role: 'ai' as const,
            content: '',
            isSystem: false
        }];
    });

    const prompt = `Tool declined: ${resultPayload}.\n\nThe user declined the tool execution. Please acknowledge this and proceed with the conversation or tasks as appropriate based on the current context.`;
    
    // Defer the stream start to ensure historyToPass is populated from the state update if needed, 
    // but here we can just use the local historyToPass we constructed.
    setTimeout(() => {
        startAIStream(prompt, historyToPass, aiMsgId, [], [], true);
    }, 0);
  }


  const handleRetry = (messageId: string) => {
    const msgIndex = messages.findIndex(m => m.id === messageId);
    if (msgIndex === -1 || msgIndex === 0) return;

    const aiMsg = messages[msgIndex];
    if (aiMsg.role !== 'ai') return;

    // The trigger message is the one immediately before the failed AI response.
    // It could be a user message or a hidden tool result.
    const triggerMsg = messages[msgIndex - 1];
    const history = messages.slice(0, msgIndex - 1);

    // Reset AI message state
    setMessages(p => p.map(m => m.id === messageId ? { ...m, content: '', hasError: false } : m));
    
    // Restart stream
    startAIStream(triggerMsg.content, history, messageId, triggerMsg.contexts || [], triggerMsg.mentions || [], triggerMsg.isSystem);
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
            isHidden: true,
            isSystem: true
        }];
        
        return [...historyToPass, {
            id: aiMsgId,
            role: 'ai' as const,
            content: '',
            isSystem: false
        }];
    });

    const prompt = `Tool Result:\n\`\`\`json\n${resultPayload}\n\`\`\`\n\nThe tool executed successfully..`;
    
    // Keep it as system prompt
    setTimeout(() => {
        startAIStream(prompt, historyToPass, aiMsgId, [], [], true);
    }, 0);
  }

  const handleSend = async (prompt: string, currentContexts: any[], currentMentions: any[]) => {
    if (!prompt && currentContexts.length === 0) return


      
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
            contexts: resolvedContexts,
            mentions: currentMentions
          },
          {
            id: aiMessageId,
            role: 'ai',
            content: ''
          }
        ]);

        startAIStream(prompt, messages, aiMessageId, resolvedContexts, currentMentions, false);

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
    <div className="ai-sidebar" style={{ width: `${width}px`, position: 'relative' }}>
      <AISettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        options={aiOptions} 
        onOptionsChange={setAiOptions} 
      />
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
            onClick={() => setIsSettingsOpen(true)} 
            title="Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
          <button 
            className="ai-close-btn" 
            onClick={() => { setMessages([]) }} 
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
            <span>Type / to attach chat history.</span>
            <span>Type @ to mention a contact.</span>
          </div>
        ) : (
          messages.filter(m => !m.isHidden).map(msg => (
            <AIMessageBubble
              key={msg.id}
              message={msg}
              availableTools={availableTools}
              isExecuting={executingToolId === msg.id}
              onApprove={executeToolCall}
              onDecline={declineToolCall}
              onRetry={() => handleRetry(msg.id)}
            />
          ))
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

      <AISmartInput 
        chatList={chatList} 
        onSend={handleSend} 
        disabled={loading} 
      />
    </div>
  )
}

