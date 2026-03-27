import { NovaInterface } from './components/NovaInterface';
import { useState, useEffect } from 'react';
import { getNovaStatus, getSourceLabel, type AISource } from './runanywhere';
import { VisionTab } from './components/VisionTab';
import { VoiceTab } from './components/VoiceTab';
import { ToolsTab } from './components/ToolsTab';

type Tab = 'chat' | 'vision' | 'voice' | 'tools';

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [source, setSource] = useState<AISource>('ollama');

  useEffect(() => {
    // Check NOVA system status on load
    getNovaStatus().then(status => {
      setSource(status.source);
    }).catch(() => {
      setSource('groq');
    });
  }, []);

  return (
    <>
      {/* 🔥 Main futuristic UI — loads instantly */}
      <NovaInterface />

      {/* 🔒 Hidden debug panel */}
      <div className="app" style={{ display: 'none' }}>
        <header className="app-header">
          <h1>NOVA AI</h1>
          <span className="badge">
            {getSourceLabel(source)}
          </span>
        </header>

        <nav className="tab-bar">
          <button className={activeTab === 'chat' ? 'active' : ''} onClick={() => setActiveTab('chat')}>💬 Chat</button>
          <button className={activeTab === 'vision' ? 'active' : ''} onClick={() => setActiveTab('vision')}>📷 Vision</button>
          <button className={activeTab === 'voice' ? 'active' : ''} onClick={() => setActiveTab('voice')}>🎙️ Voice</button>
          <button className={activeTab === 'tools' ? 'active' : ''} onClick={() => setActiveTab('tools')}>🔧 Tools</button>
        </nav>

        <main className="tab-content">
          {activeTab === 'vision' && <VisionTab />}
          {activeTab === 'voice' && <VoiceTab />}
          {activeTab === 'tools' && <ToolsTab />}
        </main>
      </div>
    </>
  );
}