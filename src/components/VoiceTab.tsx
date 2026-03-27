import { useState, useRef, useCallback, useEffect } from 'react';
import { useModelLoader } from '../hooks/useModelLoader';

type VoiceState = 'idle' | 'loading-models' | 'listening' | 'processing' | 'speaking';

export function VoiceTab() {
  const loader = useModelLoader('language', true);

  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      recognitionRef.current?.stop();
    };
  }, []);

  // ── Send transcript to NOVA backend ──
  const processTranscript = useCallback(async (text: string) => {
    if (!text.trim()) return;

    setVoiceState('processing');
    setTranscript(text);

    try {
      const res = await fetch('http://localhost:5000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: text }]
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
        if (isMountedRef.current) setResponse(accumulated);
      }

      // ── Speak the response ──
      if (accumulated && window.speechSynthesis) {
        setVoiceState('speaking');
        const utterance = new SpeechSynthesisUtterance(accumulated);
        utterance.lang = 'en-IN';
        utterance.rate = 1.0;
        utterance.onend = () => {
          if (isMountedRef.current) setVoiceState('idle');
        };
        window.speechSynthesis.speak(utterance);
      } else {
        setVoiceState('idle');
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isMountedRef.current) {
        setError(msg);
        setVoiceState('idle');
      }
    }
  }, []);

  // ── Start listening ──
  const startListening = useCallback(async () => {
    setTranscript('');
    setResponse('');
    setError(null);

    // Ensure Ollama is ready
    if (loader.state !== 'ready') {
      setVoiceState('loading-models');
      const ok = await loader.ensure();
      if (!ok) {
        setError('Could not connect to Ollama. Make sure it is running.');
        setVoiceState('idle');
        return;
      }
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError('Speech recognition not supported. Please use Chrome or Edge.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      processTranscript(text);
    };

    recognition.onerror = (event: any) => {
      if (event.error !== 'aborted') {
        setError(`Mic error: ${event.error}`);
        setVoiceState('idle');
      }
    };

    recognition.onend = () => {
      if (isMountedRef.current && voiceState === 'listening') {
        setVoiceState('idle');
      }
    };

    recognitionRef.current = recognition;
    setVoiceState('listening');
    recognition.start();
  }, [loader, processTranscript, voiceState]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setVoiceState('idle');
  }, []);

  return (
    <div className="tab-panel voice-panel">
      {error && (
        <div className="model-banner">
          <span className="error-text">{error}</span>
        </div>
      )}

      <div className="voice-center">
        <div className="voice-orb" data-state={voiceState}>
          <div className="voice-orb-inner" />
        </div>

        <p className="voice-status">
          {voiceState === 'idle' && 'Tap to start listening'}
          {voiceState === 'loading-models' && 'Connecting to Ollama...'}
          {voiceState === 'listening' && 'Listening... speak now'}
          {voiceState === 'processing' && 'Processing with NOVA...'}
          {voiceState === 'speaking' && 'Speaking...'}
        </p>

        {voiceState === 'idle' || voiceState === 'loading-models' ? (
          <button
            className="btn btn-primary btn-lg"
            onClick={startListening}
            disabled={voiceState === 'loading-models'}
          >
            Start Listening
          </button>
        ) : voiceState === 'listening' ? (
          <button className="btn btn-lg" onClick={stopListening}>
            Stop
          </button>
        ) : null}
      </div>

      {transcript && (
        <div className="voice-transcript">
          <h4>You said:</h4>
          <p>{transcript}</p>
        </div>
      )}

      {response && (
        <div className="voice-response">
          <h4>NOVA response:</h4>
          <p>{response}</p>
        </div>
      )}
    </div>
  );
}