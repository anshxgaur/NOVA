import React, { useState, useEffect, useRef, useCallback } from 'react';
import '../styles/NovaTheme.css';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

export function NovaInterface() {
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: 'SYSTEM: NOVA core online. Ready.' }
  ]);
  const [generating, setGenerating] = useState(false);
  const cancelRef = useRef<AbortController | null>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-IN', { hour12: false }));
      setDate(now.toDateString() + " IST");
    };
    const timer = setInterval(updateClock, 1000);
    updateClock();
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (rightPanelRef.current) {
      rightPanelRef.current.scrollTop = rightPanelRef.current.scrollHeight;
    }
  }, [messages]);

  const handleCommand = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || generating) return;

    setInputValue('');
    setGenerating(true);

    const userMsg: Message = { role: 'user', text };
    const assistantMsg: Message = { role: 'assistant', text: '...' };
    setMessages(prev => [...prev, userMsg, assistantMsg]);

    const controller = new AbortController();
    cancelRef.current = controller;

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 1024,
          stream: true,
          messages: [
            {
              role: 'system',
              content: 'You are NOVA, an advanced AI assistant with a sleek futuristic personality. Be helpful, concise, and slightly futuristic in tone. Keep responses short and punchy unless asked for detail.'
            },
            ...messages.map(m => ({ role: m.role, content: m.text })),
            { role: 'user', content: text }
          ],
        }),
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              accumulated += delta;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', text: accumulated };
                return updated;
              });
            }
          } catch {}
        }
      }

    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', text: `ERROR: ${msg}` };
        return updated;
      });
    } finally {
      cancelRef.current = null;
      setGenerating(false);
    }
  }, [inputValue, generating, messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleCommand();
  };

  return (
    <div className="nova-container">
      <div className="top-left">
        NOVA INTERFACE v2.0
        <span style={{
          color: '#00ff88',
          marginLeft: '15px',
          fontSize: '0.75rem',
          border: '1px solid #00ff8844',
          padding: '2px 8px',
          borderRadius: '4px',
          textShadow: '0 0 5px #00ff88'
        }}>
          [CORE: GROQ ⚡]
        </span>
      </div>

      <div className="top-center">{time}</div>
      <div className="date-display">{date}</div>
      <div className="top-right" style={{ color: '#00eaff' }}>
        {generating ? 'PROCESSING...' : 'SECURE LINK: ACTIVE'}
      </div>

      <div className="orb-ring"></div>
      <div className="glow-circle"></div>

      <div className="right-panel" ref={rightPanelRef}>
        <h3>SYSTEM LOG</h3>
        {messages.map((msg, idx) => (
          <div key={idx} className={msg.role === 'user' ? 'user-message' : 'ai-message'}>
            {msg.role === 'user' ? `> USER: ${msg.text}` : msg.text}
          </div>
        ))}
      </div>

      <div className="audio-bars">
        <div className="bar"></div>
        <div className="bar"></div>
        <div className="bar"></div>
        <div className="bar"></div>
        <div className="bar"></div>
      </div>

      <div className="command-center">
        <input
          type="text"
          className="command-input"
          placeholder={generating ? "PROCESSING..." : "ENTER COMMAND..."}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={generating}
          autoFocus
        />
      </div>
    </div>
  );
}