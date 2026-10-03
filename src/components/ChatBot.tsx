import { useState, useRef, useEffect } from 'react';
import { Bot, Send, Trash2, AlertTriangle } from 'lucide-react';
import { getSetting, useSetting } from '../lib/settings';
import { apiFetch } from '../lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

type OllamaModel = {
  name: string;
  capabilities?: string[];
};

// Security: Only Ollama models (local, no API keys needed)
// Models are discovered dynamically from the running Ollama instance.
export function ChatBot() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  // Persisted + synced with SettingsPanel automatically
  const [selectedModel, setSelectedModel] = useSetting('chatbot-model', '');
  const [loading, setLoading] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'available' | 'unavailable'>(
    'checking'
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Check Ollama availability and get installed models
  useEffect(() => {
    const checkOllama = async () => {
      try {
        const response = await apiFetch('/api/ollama/api/tags');
        if (response.ok) {
          const data = await response.json();
          const modelNames =
            (data.models as OllamaModel[] | undefined)
              ?.filter(m => {
                const caps = m.capabilities ?? [];
                // Chat-capable only: drop embedding-only models (bge-m3, nomic-embed-text, ...)
                return caps.length === 0 || caps.some(c => c !== 'embedding');
              })
              .map(m => m.name) ?? [];
          setAvailableModels(modelNames);
          // Read the persisted value directly — this runs on an interval, so
          // the closure over selectedModel would be stale.
          const current = getSetting('chatbot-model', '');
          if (!current || !modelNames.includes(current)) {
            setSelectedModel(modelNames[0] ?? '');
          }
          setOllamaStatus('available');
        } else {
          setOllamaStatus('unavailable');
        }
      } catch (error) {
        console.error('Ollama check failed:', error);
        setOllamaStatus('unavailable');
      }
    };

    checkOllama();
    // Re-check every 30 seconds
    const interval = setInterval(checkOllama, 30000);
    return () => clearInterval(interval);
  }, [setSelectedModel]);

  const sendMessage = async () => {
    if (!input.trim()) return;

    // Check if Ollama is available
    if (ollamaStatus === 'unavailable') {
      const errorMsg: Message = {
        role: 'assistant',
        content: 'Ollama is not running. Start it with: ollama serve',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMsg]);
      return;
    }

    // Check if a model is selected and available
    if (!selectedModel || !availableModels.includes(selectedModel)) {
      const errorMsg: Message = {
        role: 'assistant',
        content: `No model selected.\n\nAvailable models: ${
          availableModels.length > 0 ? availableModels.join(', ') : 'None'
        }`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMsg]);
      return;
    }

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    const currentInput = input;
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      // Ollama API call (local, no API key needed)
      const response = await apiFetch('/api/ollama/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: selectedModel,
          prompt: currentInput,
          stream: false,
          options: {
            temperature: 0.7,
            top_p: 0.95,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Ollama API Error: ${response.status} ${response.statusText}`
        );
      }

      const result = await response.json();
      const responseText = result.response || 'No response from model';

      const assistantMessage: Message = {
        role: 'assistant',
        content: responseText,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to get response'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-line">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-accent" />
          <h3 className="text-lg font-bold">AI CHATBOT</h3>
          {ollamaStatus === 'checking' && (
            <span className="text-xs bg-yellow-900/30 border border-yellow-500/50 text-yellow-300 px-2 py-1 rounded font-mono">
              CHECKING...
            </span>
          )}
          {ollamaStatus === 'available' && (
            <span className="text-xs bg-green-900/30 border border-green-500/50 text-green-300 px-2 py-1 rounded font-mono">
              OLLAMA READY ({availableModels.length})
            </span>
          )}
          {ollamaStatus === 'unavailable' && (
            <span className="text-xs bg-red-900/30 border border-red-500/50 text-red-300 px-2 py-1 rounded font-mono">
              OLLAMA OFFLINE
            </span>
          )}
        </div>
        <button
          onClick={clearChat}
          className="p-2 hover:bg-accent/10 rounded transition-all"
          title="Clear Chat"
        >
          <Trash2 className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      {/* Model Selection */}
      <div className="mb-4">
        <label className="text-xs text-gray-400 mb-2 block">SELECT LOCAL MODEL (Ollama)</label>
        <select
          value={selectedModel}
          onChange={e => setSelectedModel(e.target.value)}
          className="w-full bg-bg border border-line rounded px-3 py-2 text-sm text-accent font-mono focus:border-accent focus:outline-none"
          disabled={ollamaStatus !== 'available' || availableModels.length === 0}
        >
          {availableModels.length === 0 && (
            <option value="">No chat-capable models installed</option>
          )}
          {availableModels.map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        {ollamaStatus === 'available' && availableModels.length === 0 && (
          <div className="mt-2 text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-500/30 rounded px-2 py-1">
            <AlertTriangle size={12} className="inline mr-1" />
            No chat-capable models found. Install one with e.g.{' '}
            <code className="font-mono">ollama pull qwen3:8b</code>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto mb-4 space-y-3 min-h-0">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 text-sm mt-8">
            Start a conversation with AI...
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-lg select-text ${
                msg.role === 'user'
                  ? 'bg-accent/10 border border-accent/30 ml-8'
                  : 'bg-bg border border-line mr-8'
              }`}
            >
              <div className="flex items-start gap-2">
                <div
                  className={`text-xs font-bold ${
                    msg.role === 'user' ? 'text-accent' : 'text-accent-bright'
                  }`}
                >
                  {msg.role === 'user' ? 'YOU' : 'AI'}
                </div>
                <div className="text-xs text-gray-500">{msg.timestamp.toLocaleTimeString()}</div>
              </div>
              <div className="mt-2 text-sm whitespace-pre-wrap select-text">{msg.content}</div>
            </div>
          ))
        )}
        {loading && (
          <div className="text-center text-accent text-sm">
            AI is thinking<span className="blink-cursor"></span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message..."
          className="flex-1 bg-bg border border-line rounded px-3 py-2 text-sm focus:border-accent focus:outline-none"
          disabled={loading}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          className="ls-button px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
