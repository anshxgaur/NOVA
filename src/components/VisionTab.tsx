import { useState, useRef, useEffect, useCallback } from 'react';

interface VisionResult {
  text: string;
  totalMs: number;
}

export function VisionTab() {
  const [cameraActive, setCameraActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('Describe what you see briefly.');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoMountRef = useRef<HTMLDivElement>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // ── Start Camera ──
  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;

      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;
      video.style.width = '100%';
      video.style.borderRadius = '12px';
      videoRef.current = video;

      if (videoMountRef.current) {
        videoMountRef.current.innerHTML = '';
        videoMountRef.current.appendChild(video);
      }

      setCameraActive(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('NotAllowed') || msg.includes('Permission')) {
        setError('Camera permission denied. Please allow camera access in your browser.');
      } else if (msg.includes('NotFound')) {
        setError('No camera found on this device.');
      } else {
        setError(`Camera error: ${msg}`);
      }
    }
  }, []);

  // ── Capture Frame + Send to NOVA backend ──
  const describeFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !cameraActive) {
      await startCamera();
      return;
    }

    setProcessing(true);
    setError(null);
    const t0 = performance.now();

    try {
      // Capture frame from video
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0, 512, 512);
      const base64Image = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

      // Send to NOVA backend
      const res = await fetch('http://localhost:5000/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image, prompt }),
      });

      if (!res.ok) throw new Error(`Backend error: ${res.status}`);

      const data = await res.json();
      setResult({ text: data.result || data.text || 'No description available.', totalMs: performance.now() - t0 });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Vision API not implemented yet — show helpful message
      if (msg.includes('404') || msg.includes('Backend error')) {
        setResult({
          text: 'Vision API coming soon! The camera is working — backend vision endpoint needs to be added to app.py.',
          totalMs: performance.now() - t0
        });
      } else {
        setError(msg);
      }
    } finally {
      setProcessing(false);
    }
  }, [cameraActive, prompt, startCamera]);

  return (
    <div className="tab-panel vision-panel">
      <div className="vision-camera">
        {!cameraActive && (
          <div className="empty-state">
            <h3>📷 Camera Preview</h3>
            <p>Tap below to start the camera</p>
          </div>
        )}
        <div ref={videoMountRef} />
      </div>

      <input
        className="vision-prompt"
        type="text"
        placeholder="What do you want to know about the image?"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={processing}
      />

      <div className="vision-actions">
        {!cameraActive ? (
          <button className="btn btn-primary" onClick={startCamera}>
            Start Camera
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={describeFrame}
            disabled={processing}
          >
            {processing ? 'Analyzing...' : 'Describe'}
          </button>
        )}
      </div>

      {error && (
        <div className="vision-result">
          <span className="error-text">Error: {error}</span>
        </div>
      )}

      {result && (
        <div className="vision-result">
          <h4>Result</h4>
          <p>{result.text}</p>
          {result.totalMs > 0 && (
            <div className="message-stats">{(result.totalMs / 1000).toFixed(1)}s</div>
          )}
        </div>
      )}
    </div>
  );
}