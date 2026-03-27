import { useState, useRef, useEffect, useCallback } from 'react';
import { ALL_DEMO_TOOLS } from '../services/demo_tools';

interface TraceStep {
  type: 'user' | 'tool_call' | 'tool_result' | 'response';
  content: string;
}

interface ToolDef {
  name: string;
  description: string;
  category: string;
  executor: (args: Record<string, any>) => Promise<Record<string, any>>;
}

// ── Tool registry (in-memory) ──
const toolRegistry = new Map<string, ToolDef>();

export function ToolsTab() {
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [registeredTools, setRegisteredTools] = useState<ToolDef[]>([]);
  const [showRegistry, setShowRegistry] = useState(false);
  const traceRef = useRef<HTMLDivElement>(null);

  // ── Register demo tools on mount ──
  useEffect(() => {
    toolRegistry.clear();
    for (const { def, executor } of ALL_DEMO_TOOLS) {
      toolRegistry.set(def.name, { ...def, executor });
    }
    setRegisteredTools(Array.from(toolRegistry.values()));
  }, []);

  // ── Auto-scroll trace ──
  useEffect(() => {
    traceRef.current?.scrollTo({ top: traceRef.current.scrollHeight, behavior: 'smooth' });
  }, [trace]);

  // ── Send to NOVA backend with tool context ──
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || generating) return;

    setInput('');
    setGenerating(true);

    const steps: TraceStep[] = [{ type: 'user', content: text }];
    setTrace(steps);

    try {
      // Build tool descriptions for the prompt
      const toolDescriptions = Array.from(toolRegistry.values())
        .map(t => `- ${t.name}: ${t.description}`)
        .join('\n');

      const systemPrompt = `You are NOVA. You have access to these tools:\n${toolDescriptions}\n\nIf the user asks something a tool can help with, respond with: TOOL:tool_name:{"param":"value"}\nOtherwise respond normally.`;

      const res = await fetch('http://localhost:5000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
          ]
        }),
      });

      if (!res.ok) throw new Error(`Backend error: ${res.status}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
      }

      // ── Check if response is a tool call ──
      const toolMatch = accumulated.match(/TOOL:(\w+):(.*)/s);
      if (toolMatch) {
        const toolName = toolMatch[1];
        const argsStr = toolMatch[2].trim();
        const tool = toolRegistry.get(toolName);

        if (tool) {
          steps.push({ type: 'tool_call', content: `${toolName}(${argsStr})` });
          setTrace([...steps]);

          try {
            const args = JSON.parse(argsStr);
            const result = await tool.executor(args);
            const resultStr = JSON.stringify(result, null, 2);
            steps.push({ type: 'tool_result', content: resultStr });
            setTrace([...steps]);

            // Send result back to get final response
            const finalRes = await fetch('http://localhost:5000/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messages: [
                  { role: 'user', content: text },
                  { role: 'assistant', content: `Tool result: ${resultStr}` },
                  { role: 'user', content: 'Now give me a friendly response based on this result.' }
                ]
              }),
            });

            const finalReader = finalRes.body!.getReader();
            let finalText = '';
            while (true) {
              const { done, value } = await finalReader.read();
              if (done) break;
              finalText += decoder.decode(value, { stream: true });
            }
            steps.push({ type: 'response', content: finalText });
          } catch {
            steps.push({ type: 'response', content: accumulated });
          }
        } else {
          steps.push({ type: 'response', content: accumulated });
        }
      } else {
        steps.push({ type: 'response', content: accumulated });
      }

      setTrace([...steps]);
    } catch (err) {
      setTrace(prev => [...prev, { type: 'response', content: `Error: ${err}` }]);
    } finally {
      setGenerating(false);
    }
  }, [input, generating]);

  return (
    <div className="tab-panel tools-panel">
      <div className="tools-toolbar">
        <button
          className={`btn btn-sm ${showRegistry ? 'btn-primary' : ''}`}
          onClick={() => setShowRegistry(!showRegistry)}
        >
          🔧 Tools ({registeredTools.length})
        </button>
      </div>

      {showRegistry && (
        <div className="tools-registry">
          {registeredTools.map(t => (
            <div key={t.name} className="tool-card">
              <div className="tool-card-header">
                <strong>{t.name}</strong>
                <span style={{ fontSize: '0.7rem', color: '#00eaff88' }}>{t.category}</span>
              </div>
              <p className="tool-card-desc">{t.description}</p>
            </div>
          ))}
        </div>
      )}

      <div className="tools-trace" ref={traceRef}>
        {trace.map((step, i) => (
          <div key={i} className={`trace-step trace-${step.type}`}>
            <div className="trace-label">{step.type.toUpperCase()}</div>
            <div className="trace-content"><pre>{step.content}</pre></div>
          </div>
        ))}
      </div>

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input
          type="text"
          placeholder="Ask something... e.g. 'What's the weather in Mumbai?'"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={generating}
        />
        <button type="submit" className="btn btn-primary" disabled={!input.trim() || generating}>
          {generating ? '...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
