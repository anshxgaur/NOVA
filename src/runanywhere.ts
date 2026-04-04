/**
 * NOVA V6 - SMART AI ROUTER
 * Online  → Groq API direct (fast, cloud)
 * Offline → Ollama direct  (local, no internet needed)
 */

const OLLAMA_URL = 'http://localhost:11434';
const BACKEND_URL = 'http://localhost:5000';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const OLLAMA_MODEL = 'llama3.2';

const NOVA_SYSTEM_PROMPT =
  'You are NOVA, a friendly and warm AI companion. Talk like a close friend — casual, fun, and supportive. Keep responses short and natural. Never use markdown formatting like **, *, #, or backticks. Never use emojis. Write in plain text only.';

export type AISource = 'ollama' | 'groq' | 'cache' | 'offline';

export interface NovaStatus {
  ollama: boolean;
  backend: boolean;
  model: string;
  source: AISource;
}

/** Check if the user has internet access by pinging a reliable endpoint */
export async function isInternetOnline(): Promise<boolean> {
  try {
    const res = await fetch('https://api.groq.com/', {
      method: 'HEAD',
      signal: AbortSignal.timeout(3000),
    });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

/** Check if Ollama is running locally */
export async function isOllamaOnline(): Promise<boolean> {
  try {
    const res = await fetch(OLLAMA_URL, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Check if Flask backend is running */
export async function isBackendOnline(): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Get full NOVA system status */
export async function getNovaStatus(): Promise<NovaStatus> {
  const [internet, ollama] = await Promise.all([
    isInternetOnline(),
    isOllamaOnline(),
  ]);

  const source: AISource = internet ? 'groq' : ollama ? 'ollama' : 'offline';
  const model = internet ? GROQ_MODEL : OLLAMA_MODEL;

  return { ollama, backend: internet, model, source };
}

/**
 * Stream a chat response directly from Groq API (online mode).
 * Yields text chunks as they arrive (SSE streaming).
 */
export async function* streamGroqDirect(
  messages: { role: string; content: string; image?: string }[]
): AsyncGenerator<string> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!apiKey) throw new Error('VITE_GROQ_API_KEY not set in .env');

  const hasImage = messages.some(m => m.image);
  const MODEL = hasImage ? 'llama-3.2-90b-vision-preview' : GROQ_MODEL;

  const formattedMessages = messages.map(m => {
    if (m.image) {
      return {
        role: m.role,
        content: [
          { type: 'text', text: m.content },
          { type: 'image_url', image_url: { url: m.image } }
        ]
      };
    }
    return { role: m.role, content: m.content };
  });

  const fullMessages = [
    { role: 'system', content: NOVA_SYSTEM_PROMPT },
    ...formattedMessages,
  ];

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: fullMessages,
      stream: true,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq error ${res.status}: ${errText}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    const lines = text.split('\n').filter(l => l.startsWith('data: '));
    for (const line of lines) {
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') return;
      try {
        const data = JSON.parse(raw);
        const chunk = data?.choices?.[0]?.delta?.content;
        if (chunk) yield chunk;
      } catch {
        // skip malformed SSE lines
      }
    }
  }
}

/**
 * Stream a chat response directly from Ollama (offline fallback).
 * Yields text chunks just like streamGroqDirect does.
 */
export async function* streamOllamaDirect(
  messages: { role: string; content: string; image?: string }[],
  model = OLLAMA_MODEL
): AsyncGenerator<string> {
  const hasImage = messages.some(m => m.image);
  const formattedMessages = messages.map(m => {
    if (m.image) {
      const b64 = m.image.split(',')[1] || m.image;
      return { role: m.role, content: m.content, images: [b64] };
    }
    return { role: m.role, content: m.content };
  });

  const USE_MODEL = hasImage ? 'llava' : model;

  const fullMessages = [
    { role: 'system', content: NOVA_SYSTEM_PROMPT },
    ...formattedMessages,
  ];

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: USE_MODEL, messages: fullMessages, stream: true }),
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        const chunk = data?.message?.content;
        if (chunk) yield chunk;
        if (data?.done) return;
      } catch {
        // skip malformed lines
      }
    }
  }
}

export function getSourceLabel(source: AISource): string {
  switch (source) {
    case 'ollama': return '[CORE: OLLAMA 🦙]';
    case 'cache': return '[CORE: CACHE ⚡]';
    case 'groq': return '[CORE: GROQ 🌐]';
    case 'offline': return '[CORE: OFFLINE ❌]';
    default: return '[CORE: UNKNOWN]';
  }
}

export function getSourceColor(source: AISource): string {
  switch (source) {
    case 'ollama': return '#00ff88';
    case 'cache': return '#ffaa00';
    case 'groq': return '#ff3cac';
    case 'offline': return '#ff3333';
    default: return '#00eaff';
  }
}

export { OLLAMA_URL, BACKEND_URL };