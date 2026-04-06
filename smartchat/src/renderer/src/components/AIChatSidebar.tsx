import { useState, useRef, useEffect } from 'react'
import { ChatItem } from '../types'
import AISmartInput from './AISmartInput'
import AIMessageBubble from './AIMessageBubble'



interface AIChatMessage {
  id: string
  role: 'user' | 'ai'
  content: string
  contexts?: any[]
  mentions?: any[]
  isHidden?: boolean
  toolResult?: string
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

  const startAIStream = (prompt: string, history: AIChatMessage[], aiMsgId: string, context: any[] = [], mentions: any[] = []) => {
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
        history.filter(m => !m.isHidden),
        mentions,
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
           setMessages(p => p.map(m => m.id === aiMsgId ? { ...m, content: m.content + '\n\n**Error:** ' + String(err) } : m));
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
            isHidden: true
        }];
        
        return [...historyToPass, {
            id: aiMsgId,
            role: 'ai' as const,
            content: ''
        }];
    });

    const prompt = `Tool Execution Result: ${resultPayload}\n\nThe user declined the tool execution. Please acknowledge this and continue your response seamlessly.`;
    
    // Defer the stream start to ensure historyToPass is populated from the state update if needed, 
    // but here we can just use the local historyToPass we constructed.
    setTimeout(() => {
        startAIStream(prompt, historyToPass, aiMsgId);
    }, 0);
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

    const prompt = `Tool Execution Result:\n\`\`\`json\n${resultPayload}\n\`\`\`\n\nThe tool executed successfully. Continue your response by summarizing the action to the user seamlessly.`;
    
    setTimeout(() => {
        startAIStream(prompt, historyToPass, aiMsgId);
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

        startAIStream(prompt, messages, aiMessageId, resolvedContexts, currentMentions);

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

