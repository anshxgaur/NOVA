import React, {
  useState, useEffect, useRef, useCallback, KeyboardEvent,
} from 'react';
import '../styles/NovaTheme.css';
import { streamGroqDirect, streamOllamaDirect, getNovaStatus, type AISource } from '../runanywhere';

async function sendToNova(
  text: string,
  aiSource: AISource,
  history: { role: string; content: string }[],
  onChunk: (chunk: string) => void
) {
  const stream = aiSource === 'ollama'
    ? streamOllamaDirect([...history, { role: 'user', content: text }])
    : streamGroqDirect([...history, { role: 'user', content: text }]);
  for await (const chunk of stream) {
    onChunk(chunk);
  }
}

/* ═══════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════ */
interface Message { id: string; role: 'user' | 'assistant' | 'system'; text: string; streaming?: boolean; }
interface Memory { id: string; text: string; timestamp: string; }
interface Conversation { id: string; label: string; messages: Message[]; }
type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

/* ═══════════════════════════════════════════════════════════════
   VOICE-REACTIVE PARTICLE SPHERE
   ═══════════════════════════════════════════════════════════════ */
function ParticleSphere({
  voiceState,
  analyserNode,
}: {
  voiceState: VoiceState;
  analyserNode: AnalyserNode | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const dpr = window.devicePixelRatio || 1;
    const ORB = 520;
    const WAVE_H = 72;
    const W = ORB, H = ORB + WAVE_H;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.scale(dpr, dpr);

    const cx = W / 2, cy = ORB / 2;
    const FFT_SIZE = analyserNode?.frequencyBinCount ?? 128;
    const freqData = new Uint8Array(FFT_SIZE);

    const N = 320;
    interface P { theta: number; phi: number; speed: number; size: number; opacity: number; color: string; shimPh: number; }
    const colors = ['rgba(255,255,255,', 'rgba(190,255,240,', 'rgba(160,240,225,'];
    const pts: P[] = Array.from({ length: N }, (_, i) => ({
      phi: Math.acos(1 - (2 * (i + 0.5)) / N),
      theta: Math.PI * (1 + Math.sqrt(5)) * i,
      speed: 0.00020 + Math.random() * 0.00030,
      size: Math.random() < 0.10 ? 3.0 : Math.random() < 0.40 ? 2.0 : 1.4,
      opacity: 0.32 + Math.random() * 0.68,
      color: colors[Math.floor(Math.random() * colors.length)],
      shimPh: Math.random() * Math.PI * 2,
    }));

    const BASE_R: Record<VoiceState, number> = { idle: 160, listening: 175, processing: 155, speaking: 175 };
    const BASE_ROT: Record<VoiceState, number> = { idle: 0.07, listening: 0.15, processing: 0.10, speaking: 0.14 };

    let radius = BASE_R[voiceState];
    let rotY = 0;
    let rotXTilt = 0;
    let sBass = 0, sMid = 0, sHigh = 0;
    let pulse = 0, prevBass = 0;

    const WLEN = 220;
    const wBuf = new Float32Array(WLEN);
    let wHead = 0, wSm = 0;

    const binAvg = (lo: number, hi: number): number => {
      let s = 0, n = Math.max(1, hi - lo);
      for (let b = lo; b < hi && b < FFT_SIZE; b++) s += freqData[b];
      return s / n / 255;
    };

    let lastTs = 0;
    function frame(ts: number) {
      const dt = Math.min(ts - lastTs, 50) / 1000;
      lastTs = ts;

      if (analyserNode) analyserNode.getByteFrequencyData(freqData);

      const rawBass = binAvg(0, 9);
      const rawMid = binAvg(9, 80);
      const rawHigh = binAvg(80, FFT_SIZE);

      sBass += (rawBass - sBass) * 0.26;
      sMid += (rawMid - sMid) * 0.14;
      sHigh += (rawHigh - sHigh) * 0.10;

      const bassRise = sBass - prevBass;
      if (bassRise > 0.12 && sBass > 0.15) pulse = Math.min(pulse + bassRise * 3.0, 1.0);
      prevBass = sBass;
      pulse *= 0.91;

      const targetR = BASE_R[voiceState] + sBass * 38 + sMid * 8 + pulse * 16;
      radius += (targetR - radius) * 0.13;

      const rotYSpeed = BASE_ROT[voiceState] + sMid * 0.08;
      rotY += rotYSpeed * dt;
      rotXTilt = Math.sin(ts * 0.00025) * 0.28;

      wSm += 0.20 * (sBass - wSm);
      wBuf[wHead] = wSm;
      wHead = (wHead + 1) % WLEN;

      ctx.clearRect(0, 0, W, H);

      {
        const g1A = (voiceState === 'idle' ? 0.025 : 0.04) + sBass * 0.14 + pulse * 0.09;
        const g2A = g1A * 0.25;
        const gc = voiceState === 'speaking' ? 'rgba(60,120,255,' : 'rgba(34,197,130,';

        const gInner = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.6);
        gInner.addColorStop(0, gc + (g1A * 0.6).toFixed(3) + ')');
        gInner.addColorStop(1, 'transparent');

        const gOuter = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius + 32);
        gOuter.addColorStop(0, gc + g1A.toFixed(3) + ')');
        gOuter.addColorStop(0.5, gc + g2A.toFixed(3) + ')');
        gOuter.addColorStop(1, 'transparent');

        ctx.fillStyle = gOuter; ctx.fillRect(0, 0, W, ORB);
        ctx.fillStyle = gInner; ctx.fillRect(0, 0, W, ORB);
      }

      const cosX = Math.cos(rotXTilt), sinX = Math.sin(rotXTilt);

      const projected = pts.map(p => {
        const th = p.theta + rotY * p.speed * 3000;
        const sPhi = Math.sin(p.phi), cPhi = Math.cos(p.phi);
        const sTh = Math.sin(th), cTh = Math.cos(th);

        let x3 = radius * sPhi * cTh;
        let y3 = radius * cPhi;
        let z3 = radius * sPhi * sTh;

        const y3r = y3 * cosX + z3 * sinX;
        const z3r = -y3 * sinX + z3 * cosX;
        y3 = y3r; z3 = z3r;

        const sh = Math.sin(ts * 0.00016 * p.speed * 4 + p.shimPh) * 1.6;
        const rx = x3 + (x3 / radius) * sh;
        const ry = y3 + (y3 / radius) * sh;
        const rz = z3 + (z3 / radius) * sh;

        const persp = 1 + rz / 850;
        const px = cx + rx / persp;
        const py = cy + ry / persp;

        const depth = (rz + radius) / (2 * radius);
        const hFlick = sHigh * 0.18;
        const bBoost = sBass * 0.16 + pulse * 0.10;
        const opacity = Math.min((0.18 + depth * 0.82) * p.opacity + bBoost + hFlick, 1.0);
        const size = p.size * (0.44 + depth * 0.76) * (1 + sBass * 0.18);

        return { px, py, rz, opacity, size, color: p.color };
      });

      projected.sort((a, b) => a.rz - b.rz);

      for (const pt of projected) {
        ctx.beginPath();
        ctx.arc(pt.px, pt.py, pt.size, 0, Math.PI * 2);
        ctx.fillStyle = pt.color + pt.opacity.toFixed(2) + ')';
        ctx.fill();
      }

      // Wave line removed per user request

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [voiceState, analyserNode]);

  return <canvas ref={canvasRef} className="particle-canvas" />;
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */
const uid = () => crypto.randomUUID();
const SILENCE_TIMEOUT = 5000;

const SUGGESTIONS = [
  { icon: '🌤️', title: "What's the weather today?", sub: 'Get real-time info' },
  { icon: '🎵', title: 'Play songs on Spotify', sub: 'Control your media' },
  { icon: '💡', title: 'Help me focus for 30 mins', sub: 'Start a work session' },
  { icon: '📝', title: 'Remind me about my meeting', sub: 'Notes & reminders' },
];

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */
/* ── Reminder type ── */
interface Reminder { id: string; text: string; triggerAt: number; fired: boolean; }

/* ── Parse reminder from text, returns ms epoch or null ── */
function parseReminderTime(text: string): number | null {
  const lower = text.toLowerCase();
  const now = Date.now();

  // "in X minutes/hours"
  const inMin = lower.match(/in\s+(\d+)\s*min/);
  if (inMin) return now + parseInt(inMin[1]) * 60 * 1000;
  const inHr = lower.match(/in\s+(\d+)\s*hour/);
  if (inHr) return now + parseInt(inHr[1]) * 60 * 60 * 1000;

  // "at HH:MM" or "at H am/pm"
  const atTime = lower.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (atTime) {
    let h = parseInt(atTime[1]);
    const m = atTime[2] ? parseInt(atTime[2]) : 0;
    const meridiem = atTime[3];
    if (meridiem === 'pm' && h < 12) h += 12;
    if (meridiem === 'am' && h === 12) h = 0;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1); // next occurrence
    return d.getTime();
  }

  // "tomorrow at …"
  const tmrw = lower.match(/tomorrow.*at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (tmrw) {
    let h = parseInt(tmrw[1]);
    const m = tmrw[2] ? parseInt(tmrw[2]) : 0;
    const meridiem = tmrw[3];
    if (meridiem === 'pm' && h < 12) h += 12;
    if (meridiem === 'am' && h === 12) h = 0;
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }

  return null;
}

/* ── Extract reminder subject ── */
function extractReminderSubject(text: string): string {
  return text
    .replace(/remind me (about |to |that )?/i, '')
    .replace(/set a reminder (for |about |to )?/i, '')
    .replace(/remember (that |to )?/i, '')
    .replace(/(in \d+ (min|hour)s?|at \d+(:\d+)? ?(am|pm)?|tomorrow.*)/i, '')
    .replace(/[.,!?]+$/, '')
    .trim() || 'your reminder';
}

export function NovaInterface() {
  const [conversations, setConversations] = useState<Conversation[]>([
    { id: uid(), label: 'New conversation', messages: [] },
  ]);
  const [activeId, setActiveId] = useState<string>(conversations[0].id);
  const [inputValue, setInputValue] = useState('');
  const [generating, setGenerating] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [newMemory, setNewMemory] = useState('');
  const [time, setTime] = useState('');
  const [backendStatus, setBackendStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [searchQuery, setSearchQuery] = useState('');
  const [aiSource, setAiSource] = useState<AISource>('groq');
  const [reminders, setReminders] = useState<Reminder[]>(() => {
    try { return JSON.parse(localStorage.getItem('nova_reminders_v1') || '[]'); } catch { return []; }
  });

  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceResponse, setVoiceResponse] = useState('');
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const recognitionRef = useRef<any>(null);
  const wakeRecognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const cancelRef = useRef<AbortController | null>(null);
  const isSpeakingRef = useRef(false);
  const isProcessRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const interimTranscriptRef = useRef('');
  const pendingYoutubeRef = useRef(false);
  const micPausedRef = useRef(false);

  // Refs to sync state with callbacks
  const voiceOpenRef = useRef(voiceOpen);
  const activeConv = conversations.find(c => c.id === activeId)!;
  const messages = activeConv?.messages ?? [];
  const filteredConvs = conversations.filter(c => c.label.toLowerCase().includes(searchQuery.toLowerCase()));

  useEffect(() => { voiceOpenRef.current = voiceOpen; }, [voiceOpen]);

  /* ── Clock & Status ── */
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit' }));
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, []);

  useEffect(() => {
    getNovaStatus().then(st => setAiSource(st.source)).catch(() => setAiSource('groq'));
    fetch('http://localhost:5000/api/memory', { signal: AbortSignal.timeout(3000) })
      .then(r => setBackendStatus(r.ok ? 'online' : 'offline'))
      .catch(() => setBackendStatus('offline'));
  }, []);

  useEffect(() => {
    // Force preload voices so Neerja is immediately available on first click
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
  }, []);

  /* ── Memories ── */
  const fetchMemories = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:5000/api/memory');
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories || []);
      }
    } catch {
      const s = localStorage.getItem('nova_memories_v2');
      if (s) setMemories(JSON.parse(s));
    }
  }, []);

  useEffect(() => { fetchMemories(); }, [fetchMemories]);

  const saveMemories = (m: Memory[]) => { localStorage.setItem('nova_memories_v2', JSON.stringify(m)); setMemories(m); };

  const addMemory = useCallback(async () => {
    const text = newMemory.trim(); if (!text) return;
    setNewMemory('');
    try {
      await fetch('http://localhost:5000/api/memory/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), });
      fetchMemories();
    } catch {
      saveMemories([{ id: uid(), text, timestamp: new Date().toLocaleString('en-IN') }, ...memories].slice(0, 50));
    }
  }, [newMemory, memories, fetchMemories]);

  const deleteMemory = useCallback(async (id: string) => {
    try {
      await fetch('http://localhost:5000/api/memory/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }), });
      fetchMemories();
    } catch {
      saveMemories(memories.filter(m => m.id !== id));
    }
  }, [memories, fetchMemories]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    const ta = textareaRef.current; if (!ta) return;
    ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [inputValue]);

  const patchMessages = useCallback((id: string, fn: (m: Message[]) => Message[]) =>
    setConversations(p => p.map(c => c.id === id ? { ...c, messages: fn(c.messages) } : c)), []);

  const updateLabel = useCallback((id: string, label: string) =>
    setConversations(p => p.map(c => c.id === id ? { ...c, label } : c)), []);

  const newConversation = useCallback(() => {
    const c: Conversation = { id: uid(), label: 'New conversation', messages: [] };
    setConversations(p => [c, ...p]); setActiveId(c.id); setInputValue('');
  }, []);

  /* ═══ TEXT SEND CHAT ═══ */
  const send = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? inputValue).trim();
    if (!text || generating) return;
    setGenerating(true); setInputValue('');

    const convId = activeId, uid2 = uid(), uid3 = uid();
    if (messages.length === 0) updateLabel(convId, text.slice(0, 40) + (text.length > 40 ? '…' : ''));
    patchMessages(convId, msgs => [...msgs, { id: uid2, role: 'user', text }, { id: uid3, role: 'assistant', text: '', streaming: true }]);

    // Check Spotify
    const lower = text.toLowerCase();

    // Check reminder / note
    const isReminder = /remind me|set a reminder|remember (that|to)|note (that|down)?/i.test(lower);
    if (isReminder) {
      const subject = extractReminderSubject(text);
      const triggerAt = parseReminderTime(text);
      if (triggerAt) {
        const newReminder: Reminder = { id: uid(), text: subject, triggerAt, fired: false };
        const updated = [...reminders, newReminder];
        setReminders(updated);
        localStorage.setItem('nova_reminders_v1', JSON.stringify(updated));
        const timeStr = new Date(triggerAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        patchMessages(convId, msgs => msgs.map(m => m.id === uid3 ? { ...m, text: `✅ Got it! I'll remind you about **"${subject}"** at **${timeStr}**. I'll send you a notification.`, streaming: false } : m));
      } else {
        // Save as a memory note
        const noteText = subject;
        saveMemories([{ id: uid(), text: `📝 Note: ${noteText}`, timestamp: new Date().toLocaleString('en-IN') }, ...memories].slice(0, 50));
        patchMessages(convId, msgs => msgs.map(m => m.id === uid3 ? { ...m, text: `📝 Saved to your notes: "${noteText}". You can view it in the Memories panel.`, streaming: false } : m));
      }
      setGenerating(false); return;
    }

    // Show reminders / notes
    if (/show (my )?(reminders?|notes?|what (do i have|is scheduled))/i.test(lower)) {
      const pending = reminders.filter(r => !r.fired);
      const reply = pending.length === 0
        ? "You have no upcoming reminders. Say 'remind me about...' to add one!"
        : `You have ${pending.length} upcoming reminder${pending.length > 1 ? 's' : ''}:\n` +
          pending.map(r => `• **${r.text}** at ${new Date(r.triggerAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`).join('\n');
      patchMessages(convId, msgs => msgs.map(m => m.id === uid3 ? { ...m, text: reply, streaming: false } : m));
      setGenerating(false); return;
    }

    // Check Timer
    if (lower.includes('timer for') || lower.includes('clock for') || lower.includes('focus for') || lower.includes('set an clock')) {
      const is30 = lower.includes('30');
      const mins = is30 ? 30 : 5;
      setTimeout(() => {
        if (typeof Notification !== 'undefined') new Notification("Nova Timer", { body: `Your ${mins} minute timer is complete!` });
        speakText(`Your ${mins} minute timer is complete.`);
      }, mins * 60 * 1000);
      patchMessages(convId, msgs => msgs.map(m => m.id === uid3 ? { ...m, text: `I've set a timer for ${mins} minutes. I'll let you know when it's done.`, streaming: false } : m));
      setGenerating(false); return;
    }

    // Check YouTube multi-turn flow (via text)
    if (pendingYoutubeRef.current) {
      pendingYoutubeRef.current = false;
      const cleanSong = text.replace(/[.?!"']/g, '').trim();
      const query = encodeURIComponent(cleanSong);
      patchMessages(convId, msgs => msgs.map(m => m.id === uid3 ? { ...m, text: `Opening YouTube for "${cleanSong}"...`, streaming: false } : m));
      window.open(`https://www.youtube.com/results?search_query=${query}`, '_blank');
      setGenerating(false); return;
    }

    const cleanLower = lower.replace(/[^\w\s]/g, '').trim();
    if (cleanLower === 'play youtube' || cleanLower === 'open youtube' || cleanLower === 'youtube') {
      pendingYoutubeRef.current = true;
      patchMessages(convId, msgs => msgs.map(m => m.id === uid3 ? { ...m, text: `Which song do you want to play?`, streaming: false } : m));
      setGenerating(false); return;
    }

    if (lower.includes('play') && lower.includes('on spotify')) {
      const match = lower.match(/play\s+(.*?)\s+on spotify/);
      if (match && match[1]) {
        const song = match[1];
        patchMessages(convId, msgs => msgs.map(m => m.id === uid3 ? { ...m, text: `Opening Spotify for "${song}"...`, streaming: false } : m));
        window.open(`https://open.spotify.com/search/${encodeURIComponent(song)}`, '_blank');
        setGenerating(false); return;
      }
    }

    // Check Backend System Commands
    if (['volume', 'brightness', 'turn off', 'shutdown', 'restart'].some(k => lower.includes(k))) {
      try {
        const res = await fetch('http://localhost:5000/api/command', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: text })
        });
        if (res.ok) {
          const d = await res.json();
          if (d.status !== 'not_a_command') {
            patchMessages(convId, msgs => msgs.map(m => m.id === uid3 ? { ...m, text: d.speak || d.status, streaming: false } : m));
            setGenerating(false); return;
          }
        }
      } catch { }
    }

    try {
      const history = messages.map(m => ({ role: m.role as string, content: m.text }));
      await sendToNova(text, aiSource, history, (chunk) => {
        patchMessages(convId, msgs => msgs.map(m => m.id === uid3 ? { ...m, text: m.text + chunk } : m));
      });
      patchMessages(convId, msgs => msgs.map(m => m.id === uid3 ? { ...m, streaming: false } : m));
    } catch (err) {
      patchMessages(convId, msgs => msgs.map(m => m.id === uid3 ? { ...m, text: `Error: ${err instanceof Error ? err.message : String(err)}`, streaming: false } : m));
    } finally { setGenerating(false); }
  }, [inputValue, generating, activeId, messages.length, patchMessages, updateLabel]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  /* ═══ AUDIO METER ═══ */
  const startAudioMeter = async (): Promise<AnalyserNode | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const actx = new AudioContext();
      const analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      actx.createMediaStreamSource(stream).connect(analyser);
      audioCtxRef.current = actx;
      return analyser;
    } catch { return null; }
  };

  const stopAudioMeter = () => {
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setAnalyserNode(null);
  };

  /* ═══ TTS ═══ */
  const speakText = useCallback((text: string, onEnd?: () => void) => {
    if (!window.speechSynthesis) { onEnd?.(); return; }
    window.speechSynthesis.cancel();
    const cleanText = text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/#{1,6}\s/g, '')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1')
      .replace(/>\s/g, '')
      .replace(/[-*+]\s/g, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .trim();

    const voices = window.speechSynthesis.getVoices();
    const u = new SpeechSynthesisUtterance(cleanText);
    u.rate = 1.05;

    const preferred =
      voices.find(v => v.name.toLowerCase().includes('neerja')) ||
      voices.find(v => v.name.toLowerCase().includes('heera')) ||
      voices.find(v => v.name.toLowerCase().includes('female') && v.lang.includes('in')) ||
      voices.find(v => v.lang === 'en-IN' && !v.name.toLowerCase().includes('ravi')) ||
      voices.find(v => v.name.toLowerCase().includes('zira')) ||
      voices.find(v => v.name.toLowerCase().includes('female')) ||
      voices.find(v => v.lang.startsWith('en') && !v.name.toLowerCase().includes('david') && !v.name.toLowerCase().includes('mark') && !v.name.toLowerCase().includes('ravi')) ||
      voices[0];

    if (preferred) { u.voice = preferred; u.lang = preferred.lang; }
    else u.lang = 'en-IN';

    u.onstart = () => { isSpeakingRef.current = true; };
    u.onend = () => { isSpeakingRef.current = false; onEnd?.(); };
    u.onerror = () => { isSpeakingRef.current = false; onEnd?.(); };
    window.speechSynthesis.speak(u);
  }, []);

  /* ── Reminder polling: check every 30s ── */
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      setReminders(prev => {
        const updated = prev.map(r => {
          if (!r.fired && r.triggerAt <= now) {
            if (Notification.permission === 'granted') {
              new Notification('⏰ Nova Reminder', { body: r.text, icon: '/favicon.ico' });
            } else if (Notification.permission === 'default') {
              Notification.requestPermission().then(p => {
                if (p === 'granted') new Notification('⏰ Nova Reminder', { body: r.text });
              });
            }
            speakText(`Reminder: ${r.text}`);
            return { ...r, fired: true };
          }
          return r;
        });
        localStorage.setItem('nova_reminders_v1', JSON.stringify(updated));
        return updated;
      });
    };
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, [speakText]);

  /* ═══ START MAIN MIC (5 SEC SILENCE LOGIC) ═══ */
  const startListeningMain = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-IN';

    let localInterim = '';

    const clearSilence = () => {
      if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    };

    const startSilence = () => {
      clearSilence();
      silenceTimerRef.current = setTimeout(() => {
        const text = interimTranscriptRef.current.trim();
        if (text && !isSpeakingRef.current && !isProcessRef.current) {
          try { recognition.stop(); } catch { }
          interimTranscriptRef.current = '';
          setVoiceTranscript('');

          if (['stop', 'stop listening', 'stop nova'].includes(text.toLowerCase())) {
            closeVoice();
            return;
          }
          processVoiceCommandRef.current(text);
        }
      }, SILENCE_TIMEOUT);
    };

    recognition.onresult = (event: any) => {
      if (isSpeakingRef.current || isProcessRef.current) return;
      let finalStr = '';
      let interimStr = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) finalStr += event.results[i][0].transcript;
        else interimStr += event.results[i][0].transcript;
      }

      if (finalStr) {
        localInterim += ' ' + finalStr;
        interimTranscriptRef.current = localInterim;
        setVoiceTranscript(localInterim);
        startSilence();
      }

      if (interimStr) {
        setVoiceTranscript(localInterim + ' ' + interimStr);
        startSilence();
      }
    };

    recognition.onstart = () => { setVoiceState('listening'); };
    recognition.onend = () => {
      if (micPausedRef.current) return;
      if (!isSpeakingRef.current && !isProcessRef.current && voiceOpenRef.current) {
        setTimeout(() => {
          if (!micPausedRef.current && voiceOpenRef.current && !isSpeakingRef.current && !isProcessRef.current) {
            startListeningMainRef.current();
          }
        }, 100);
      } else if (!voiceOpenRef.current) {
        setVoiceState('idle');
        startWakeListenerRef.current();
      }
    };

    recognitionRef.current = recognition;
    try { recognition.start(); } catch { }
  }, []);

  const startListeningMainRef = useRef(startListeningMain);
  useEffect(() => { startListeningMainRef.current = startListeningMain; }, [startListeningMain]);

  /* ═══ PROCESS VOICE COMMAND ═══ */
  const processVoiceCommand = useCallback(async (text: string) => {
    isProcessRef.current = true;
    setVoiceTranscript(text);
    setVoiceState('processing');
    setVoiceResponse('');

    const lower = text.toLowerCase();

    // Check reminder / note (voice)
    const isReminder = /remind me|set a reminder|remember (that|to)|note (that|down)?/i.test(lower);
    if (isReminder) {
      const subject = extractReminderSubject(text);
      const triggerAt = parseReminderTime(text);
      if (triggerAt) {
        const newReminder: Reminder = { id: uid(), text: subject, triggerAt, fired: false };
        const updated = [...reminders, newReminder];
        setReminders(updated);
        localStorage.setItem('nova_reminders_v1', JSON.stringify(updated));
        const timeStr = new Date(triggerAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        const reply = `Reminder set for "${subject}" at ${timeStr}.`;
        setVoiceResponse(reply); setVoiceState('speaking');
        speakText(reply, () => { setVoiceState('listening'); isProcessRef.current = false; startListeningMainRef.current(); });
      } else {
        saveMemories([{ id: uid(), text: `📝 Note: ${subject}`, timestamp: new Date().toLocaleString('en-IN') }, ...memories].slice(0, 50));
        const reply = `Saved to your notes: "${subject}".`;
        setVoiceResponse(reply); setVoiceState('speaking');
        speakText(reply, () => { setVoiceState('listening'); isProcessRef.current = false; startListeningMainRef.current(); });
      }
      return;
    }

    // Show reminders (voice)
    if (/show (my )?(reminders?|notes?|what (do i have|is scheduled))/i.test(lower)) {
      const pending = reminders.filter(r => !r.fired);
      const reply = pending.length === 0
        ? "You have no upcoming reminders."
        : `You have ${pending.length} reminder${pending.length > 1 ? 's' : ''}. ` +
          pending.map(r => `${r.text} at ${new Date(r.triggerAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`).join(', ');
      setVoiceResponse(reply); setVoiceState('speaking');
      speakText(reply, () => { setVoiceState('listening'); isProcessRef.current = false; startListeningMainRef.current(); });
      return;
    }

    // Check Timer
    if (lower.includes('timer for') || lower.includes('clock for') || lower.includes('focus for') || lower.includes('set an clock')) {
      const is30 = lower.includes('30');
      const mins = is30 ? 30 : 5;
      setTimeout(() => {
        if (typeof Notification !== 'undefined') new Notification("Nova Timer", { body: `Your ${mins} minute timer is complete!` });
        speakText(`Your ${mins} minute timer is complete.`);
      }, mins * 60 * 1000);
      setVoiceResponse(`Timer set for ${mins} minutes`); setVoiceState('speaking');
      speakText(`Timer set for ${mins} minutes. I'll let you know when it's done.`, () => {
        setVoiceState('listening'); isProcessRef.current = false; startListeningMainRef.current();
      });
      return;
    }

    // Check YouTube multi-turn flow
    if (pendingYoutubeRef.current) {
      pendingYoutubeRef.current = false;
      const cleanSong = text.replace(/[.?!"']/g, '').trim();
      const query = encodeURIComponent(cleanSong);
      setVoiceResponse(`Playing ${cleanSong} on YouTube`); setVoiceState('speaking');
      speakText(`Opening YouTube for your song`, () => {
        setVoiceState('listening'); isProcessRef.current = false; startListeningMainRef.current();
      });
      window.open(`https://www.youtube.com/results?search_query=${query}`, '_blank');
      return;
    }

    const cleanLower = lower.replace(/[^\w\s]/g, '').trim();

    if (cleanLower === 'play youtube' || cleanLower === 'open youtube' || cleanLower === 'youtube') {
      pendingYoutubeRef.current = true;
      setVoiceResponse(`Which song do you want to play?`); setVoiceState('speaking');
      speakText(`Which song do you want to play?`, () => {
        setVoiceState('listening'); isProcessRef.current = false; startListeningMainRef.current();
      });
      return;
    }

    // Check Spotify
    if (lower.includes('play') && lower.includes('on spotify')) {
      const match = lower.match(/play\s+(.*?)\s+on spotify/);
      if (match && match[1]) {
        const query = encodeURIComponent(match[1]);
        setVoiceResponse(`Playing ${match[1]} on Spotify`); setVoiceState('speaking');
        speakText(`Playing ${match[1]} on Spotify`, () => { setVoiceState('listening'); isProcessRef.current = false; startListeningMainRef.current(); });
        window.open(`https://open.spotify.com/search/${query}`, '_blank');
        return;
      }
    }

    // Check Backend
    if (['volume', 'brightness', 'turn off', 'shutdown', 'restart'].some(k => lower.includes(k))) {
      try {
        const res = await fetch('http://localhost:5000/api/command', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: text })
        });
        if (res.ok) {
          const d = await res.json();
          if (d.status !== 'not_a_command') {
            const reply = d.speak || d.status;
            setVoiceResponse(reply); setVoiceState('speaking');
            speakText(reply, () => {
              setVoiceState('listening'); isProcessRef.current = false; startListeningMainRef.current();
            });
            return;
          }
        }
      } catch (err) { }
    }

    // AI Chat
    setVoiceState('speaking');
    let acc = '';
    try {
      const history = messages.map(m => ({ role: m.role as string, content: m.text }));
      await sendToNova(text, aiSource, history, (chunk) => { acc += chunk; setVoiceResponse(acc); });
      speakText(acc, () => { setVoiceState('listening'); isProcessRef.current = false; startListeningMainRef.current(); });
    } catch {
      speakText("I'm sorry, my systems are currently offline.", () => { setVoiceState('listening'); isProcessRef.current = false; startListeningMainRef.current(); });
    }
  }, [speakText]);

  const processVoiceCommandRef = useRef(processVoiceCommand);
  useEffect(() => { processVoiceCommandRef.current = processVoiceCommand; }, [processVoiceCommand]);

  /* ═══ WAKE LISTENER ═══ */
  const stopWakeListener = useCallback(() => {
    if (wakeRecognitionRef.current) {
      wakeRecognitionRef.current.onend = null;
      try { wakeRecognitionRef.current.stop(); } catch { }
    }
  }, []);

  const startWakeListener = useCallback(() => {
    if (voiceOpenRef.current) return;
    try { wakeRecognitionRef.current?.stop(); } catch { }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-IN';

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript.toLowerCase();
        if (transcript.includes('wake up nova') || transcript.includes('wakeup nova')) {
          try { recognition.stop(); } catch { }
          openVoice();
          return;
        }
      }
    };

    recognition.onend = () => {
      if (!voiceOpenRef.current) {
        setTimeout(() => startWakeListenerRef.current(), 500);
      }
    };

    wakeRecognitionRef.current = recognition;
    try { recognition.start(); } catch { }
  }, []);

  const startWakeListenerRef = useRef(startWakeListener);
  const stopWakeListenerRef = useRef(stopWakeListener);
  useEffect(() => { startWakeListenerRef.current = startWakeListener; stopWakeListenerRef.current = stopWakeListener; }, [startWakeListener, stopWakeListener]);

  useEffect(() => {
    startWakeListener();
    return () => { stopWakeListener(); try { recognitionRef.current?.stop(); } catch { } };
  }, [startWakeListener, stopWakeListener]);

  /* ═══ UI VOCE CONTROLS ═══ */
  const openVoice = useCallback(async () => {
    stopWakeListenerRef.current();
    setVoiceOpen(true);
    setVoiceTranscript('');
    setVoiceResponse('');
    setVoiceState('listening');
    isProcessRef.current = false;
    isSpeakingRef.current = false;
    micPausedRef.current = false;
    interimTranscriptRef.current = '';
    const an = await startAudioMeter();
    setAnalyserNode(an);
    setTimeout(() => startListeningMainRef.current(), 150);
  }, []);

  const closeVoice = useCallback(() => {
    window.speechSynthesis?.cancel();
    recognitionRef.current?.stop();
    stopAudioMeter();
    setVoiceOpen(false);
    setVoiceState('idle');
    setVoiceTranscript('');
    setVoiceResponse('');
    isProcessRef.current = false;
    isSpeakingRef.current = false;
    interimTranscriptRef.current = '';
    startWakeListenerRef.current();
  }, []);

  const toggleMic = useCallback(() => {
    if (voiceState === 'listening' || voiceState === 'processing') {
      micPausedRef.current = true;
      try { recognitionRef.current?.stop(); } catch { }
      setVoiceState('idle');
    } else if (voiceState === 'idle') {
      micPausedRef.current = false;
      startListeningMainRef.current();
    }
  }, [voiceState]);

  const copyMsg = (text: string) => navigator.clipboard.writeText(text).catch(() => { });

  const stateLabel: Record<VoiceState, string> = {
    idle: 'Tap the mic to speak', listening: 'Listening… (or say "Stop Nova")', processing: 'Thinking…', speaking: 'Speaking…'
  };

  /* ═══════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════ */
  return (
    <div className="nova-shell">
      {/* SIDEBAR */}
      <aside className="nova-sidebar">
        <div className="sidebar-top">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">⚡</div>
            <span className="sidebar-logo-text">NOVA</span>
          </div>
          <button className="new-chat-btn" onClick={newConversation} title="New chat">✏️</button>
        </div>

        <div className="sidebar-search">
          <div className="sidebar-search-inner">
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
            <input className="sidebar-search-input" placeholder="Search conversations"
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>
        </div>

        <div className="sidebar-section-label">Recents</div>
        <div className="sidebar-history">
          {filteredConvs.map(conv => (
            <div key={conv.id}
              className={`history-item ${conv.id === activeId ? 'active' : ''}`}
              onClick={() => setActiveId(conv.id)}>
              <span className="history-item-icon">💬</span>
              <span className="history-item-label">{conv.label}</span>
            </div>
          ))}
        </div>

        <div className="memory-panel">
          <div className="memory-panel-header">
            <span className="memory-panel-title">Memories</span>
            {memories.length > 0 && <button className="memory-clear-btn" onClick={() => saveMemories([])}>Clear all</button>}
          </div>
          <div className="memory-add-row">
            <input className="memory-input" placeholder="Add a memory…"
              value={newMemory} onChange={e => setNewMemory(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addMemory()} />
            <button className="memory-add-btn" onClick={addMemory}>+</button>
          </div>
          <div className="memory-list">
            {memories.map(m => (
              <div key={m.id} className="memory-chip">
                <span className="memory-chip-text">{m.text}</span>
                <button className="memory-chip-del" onClick={() => deleteMemory(m.id)}>✕</button>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-status">
          <div className={`status-dot ${backendStatus === 'online' ? '' : backendStatus === 'offline' ? 'red' : 'amber'}`} />
          <span>{backendStatus === 'online' ? 'Backend connected' : backendStatus === 'offline' ? 'Backend offline' : 'Connecting…'}</span>
        </div>
      </aside>

      {/* MAIN */}
      <main className="nova-main">
        <div className="topbar">
          <div className="topbar-left">
            <div className="model-selector">
              <div className="model-selector-icon" />
              <span>NOVA AI</span>
              <span className="model-selector-chevron">▾</span>
            </div>
          </div>
          <div className="topbar-right">
            <div className="topbar-badge"><span style={{ fontSize: 10 }}>⚡</span><span>{aiSource === 'ollama' ? 'Ollama · Llama 3' : 'Groq · Llama 3.3'}</span></div>
            <div className="topbar-time">{time}</div>
          </div>
        </div>

        <div className="chat-area">
          {messages.length === 0 ? (
            <div className="welcome-screen">
              <div className="welcome-logo">⚡</div>
              <h1 className="welcome-title">How can I help {typeof (window as any).require !== 'undefined' ? 'Sir' : ''}?</h1>
              <p className="welcome-subtitle">
                I'm NOVA — your personal AI. Ask me anything, control your computer,
                manage music, set reminders, and more.
              </p>
              <div className="welcome-suggestions">
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} className="suggestion-card" onClick={() => send(s.title)}>
                    <span className="suggestion-card-icon">{s.icon}</span>
                    <span className="suggestion-card-title">{s.title}</span>
                    <span className="suggestion-card-sub">{s.sub}</span>
                  </button>
                ))}
              </div>
              <button className="welcome-voice-btn" onClick={openVoice}>
                <span className="welcome-voice-icon">🎙️</span>
                <span>Start voice conversation</span>
              </button>
            </div>
          ) : (
            <div className="messages-container">
              {messages.map(msg => <MessageRow key={msg.id} msg={msg} onCopy={copyMsg} />)}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        <div className="input-area">
          <div className="input-wrapper">
            <div className="input-box">
              <textarea ref={textareaRef} className="input-textarea"
                placeholder="Message NOVA… (or say 'Wake up Nova')" rows={1}
                value={inputValue} onChange={e => setInputValue(e.target.value)}
                onKeyDown={onKeyDown} disabled={generating} />
              <div className="input-toolbar">
                <button className="input-tool-btn" onClick={openVoice}>🎙️ Voice</button>
                <div className="input-spacer" />
                {generating
                  ? <button className="send-btn" onClick={() => { cancelRef.current?.abort(); setGenerating(false); }}>⏹</button>
                  : <button className="send-btn" onClick={() => send()} disabled={!inputValue.trim()}>↑</button>
                }
              </div>
            </div>
            <p className="input-hint">Say <b>"Wake up Nova"</b> at any time for hands-free voice control.</p>
          </div>
        </div>
      </main>

      {/* VOICE OVERLAY */}
      {voiceOpen && (
        <div className="va-overlay">
          <button className="va-close" onClick={closeVoice} title="Close">✕</button>

          <div className="va-orb-section">
            <ParticleSphere voiceState={voiceState} analyserNode={analyserNode} />
          </div>

          <div className="va-text-section">
            {voiceTranscript
              ? <p className="va-transcript">{voiceTranscript}</p>
              : <p className="va-prompt-hint">Say something…</p>
            }
            {voiceResponse && <p className="va-response">{voiceResponse}</p>}
          </div>

          <div className="va-controls">
            <button className={`va-mic-btn ${voiceState === 'listening' ? 'active' : ''}`}
              onClick={toggleMic}
              disabled={voiceState === 'processing' || voiceState === 'speaking'}>
              {voiceState === 'listening'
                ? <span className="va-mic-icon">⏹</span>
                : voiceState === 'processing'
                  ? <span className="va-processing-icon">⋯</span>
                  : voiceState === 'speaking'
                    ? <span className="va-mic-icon">🔊</span>
                    : <span className="va-mic-icon">🎙️</span>}
            </button>
          </div>
          <p className="va-state-label">{stateLabel[voiceState]}</p>
        </div>
      )}
    </div>
  );
}

function MessageRow({ msg, onCopy }: { msg: Message; onCopy: (t: string) => void }) {
  const isUser = msg.role === 'user', isSys = msg.role === 'system';
  return (
    <div className={`message-row${isSys ? ' system' : ''}`}>
      <div className={`message-avatar ${isUser ? 'user' : 'assistant'}`}>
        {isUser ? '👤' : isSys ? '⚙️' : '⚡'}
      </div>
      <div className="message-body">
        <div className="message-role">{isUser ? 'You' : isSys ? 'System' : 'NOVA'}</div>
        {msg.text === '' && msg.streaming
          ? <div className="typing-indicator">
            <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
          </div>
          : <div className={`message-text${msg.streaming ? ' streaming' : ''}`}>{msg.text}</div>
        }
        {!msg.streaming && msg.text && (
          <div className="message-actions">
            <button className="msg-action-btn" onClick={() => onCopy(msg.text)}>📋 Copy</button>
          </div>
        )}
      </div>
    </div>
  );
}