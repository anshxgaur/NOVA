import { useState, useCallback, useRef } from 'react';

export type LoaderState = 'idle' | 'downloading' | 'loading' | 'ready' | 'error';

interface ModelLoaderResult {
  state: LoaderState;
  progress: number;
  error: string | null;
  ensure: () => Promise<boolean>;
}

const OLLAMA_URL = 'http://localhost:11434';
const OLLAMA_MODEL = 'qwen3:4b';

/**
 * Hook to check if Ollama model is ready.
 * Replaces the old RunAnywhere SDK model loader.
 */
export function useModelLoader(_category?: string, _coexist = false): ModelLoaderResult {
  const [state, setState] = useState<LoaderState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const ensure = useCallback(async (): Promise<boolean> => {
    if (state === 'ready') return true;
    if (loadingRef.current) return false;
    loadingRef.current = true;

    try {
      setState('loading');
      setProgress(0);

      // ── Step 1: Check if Ollama is running ──
      const pingRes = await fetch(OLLAMA_URL, {
        signal: AbortSignal.timeout(3000)
      });

      if (!pingRes.ok) {
        throw new Error('Ollama is not running. Please start it with: ollama serve');
      }

      setProgress(0.3);

      // ── Step 2: Check if model is available ──
      const tagsRes = await fetch(`${OLLAMA_URL}/api/tags`);
      const tagsData = await tagsRes.json();
      const models: string[] = (tagsData.models || []).map((m: any) => m.name);
      const modelAvailable = models.some(m => m.startsWith(OLLAMA_MODEL.split(':')[0]));

      setProgress(0.6);

      if (!modelAvailable) {
        // ── Step 3: Pull model if not available ──
        setState('downloading');
        console.log(`[NOVA] Pulling model ${OLLAMA_MODEL}...`);

        const pullRes = await fetch(`${OLLAMA_URL}/api/pull`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: OLLAMA_MODEL, stream: false }),
        });

        if (!pullRes.ok) {
          throw new Error(`Failed to pull model: ${pullRes.statusText}`);
        }
      }

      setProgress(1);
      setState('ready');
      console.log(`[NOVA] Model ${OLLAMA_MODEL} is ready ✅`);
      return true;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setState('error');
      console.error('[NOVA] Model loader error:', msg);
      return false;
    } finally {
      loadingRef.current = false;
    }
  }, [state]);

  return { state, progress, error, ensure };
}