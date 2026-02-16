/**
 * RunAnywhere SDK initialization and model catalog.
 *
 * This module:
 * 1. Initializes the SDK (loads WASM, registers backends)
 * 2. Registers the model catalog (LLM, VLM, STT, TTS, VAD)
 * 3. Wires up the VLM Web Worker
 *
 * Import this module once at app startup.
 */

import {
  RunAnywhere,
  SDKEnvironment,
  VLMWorkerBridge,
  SherpaONNXBridge,
  ModelManager,
  ModelCategory,
  LLMFramework,
  type CompactModelDef,
  type AccelerationMode,
} from '@runanywhere/web';

// Vite bundles the worker as a standalone JS chunk and returns its URL.
// @ts-ignore — Vite-specific ?worker&url query
import vlmWorkerUrl from './workers/vlm-worker?worker&url';

// Resolve WASM glue scripts from the npm package so Vite's dev server
// and the production build both find the right files.
const wasmCpuUrl = new URL(
  '@runanywhere/web/wasm/racommons.js',
  import.meta.url,
).href;
const wasmGpuUrl = new URL(
  '@runanywhere/web/wasm/racommons-webgpu.js',
  import.meta.url,
).href;
const sherpaGlueUrl = new URL(
  '@runanywhere/web/wasm/sherpa/sherpa-onnx-glue.js',
  import.meta.url,
).href;

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

const MODELS: CompactModelDef[] = [
  // LLM — Liquid AI LFM2 350M (small + fast for chat)
  {
    id: 'lfm2-350m-q4_k_m',
    name: 'LFM2 350M Q4_K_M',
    repo: 'LiquidAI/LFM2-350M-GGUF',
    files: ['LFM2-350M-Q4_K_M.gguf'],
    framework: LLMFramework.LlamaCpp,
    modality: ModelCategory.Language,
    memoryRequirement: 250_000_000,
  },
  // VLM — Liquid AI LFM2-VL 450M (vision + language)
  {
    id: 'lfm2-vl-450m-q4_0',
    name: 'LFM2-VL 450M Q4_0',
    repo: 'runanywhere/LFM2-VL-450M-GGUF',
    files: ['LFM2-VL-450M-Q4_0.gguf', 'mmproj-LFM2-VL-450M-Q8_0.gguf'],
    framework: LLMFramework.LlamaCpp,
    modality: ModelCategory.Multimodal,
    memoryRequirement: 500_000_000,
  },
  // STT (sherpa-onnx archive)
  {
    id: 'sherpa-onnx-whisper-tiny.en',
    name: 'Whisper Tiny English (ONNX)',
    url: 'https://huggingface.co/runanywhere/sherpa-onnx-whisper-tiny.en/resolve/main/sherpa-onnx-whisper-tiny.en.tar.gz',
    framework: LLMFramework.ONNX,
    modality: ModelCategory.SpeechRecognition,
    memoryRequirement: 105_000_000,
    artifactType: 'archive' as const,
  },
  // TTS (sherpa-onnx archive)
  {
    id: 'vits-piper-en_US-lessac-medium',
    name: 'Piper TTS US English (Lessac)',
    url: 'https://huggingface.co/runanywhere/vits-piper-en_US-lessac-medium/resolve/main/vits-piper-en_US-lessac-medium.tar.gz',
    framework: LLMFramework.ONNX,
    modality: ModelCategory.SpeechSynthesis,
    memoryRequirement: 65_000_000,
    artifactType: 'archive' as const,
  },
  // VAD (single ONNX file)
  {
    id: 'silero-vad-v5',
    name: 'Silero VAD v5',
    url: 'https://huggingface.co/runanywhere/silero-vad-v5/resolve/main/silero_vad.onnx',
    files: ['silero_vad.onnx'],
    framework: LLMFramework.ONNX,
    modality: ModelCategory.Audio,
    memoryRequirement: 5_000_000,
  },
];

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

let _initPromise: Promise<void> | null = null;

/** Initialize the RunAnywhere SDK. Safe to call multiple times. */
export async function initSDK(): Promise<void> {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    await RunAnywhere.initialize(
      {
        environment: SDKEnvironment.Development,
        debug: true,
        webgpuWasmUrl: wasmGpuUrl,
      },
      wasmCpuUrl,
    );

    // Register model catalog
    RunAnywhere.registerModels(MODELS);

    // Set Sherpa-ONNX WASM URL so STT/TTS/VAD can load
    SherpaONNXBridge.shared.wasmUrl = sherpaGlueUrl;

    // Wire up VLM worker
    VLMWorkerBridge.shared.workerUrl = vlmWorkerUrl;
    RunAnywhere.setVLMLoader({
      get isInitialized() { return VLMWorkerBridge.shared.isInitialized; },
      init: () => VLMWorkerBridge.shared.init(),
      loadModel: (params) => VLMWorkerBridge.shared.loadModel(params),
      unloadModel: () => VLMWorkerBridge.shared.unloadModel(),
    });
  })();

  return _initPromise;
}

/** Get acceleration mode after init. */
export function getAccelerationMode(): AccelerationMode | null {
  return RunAnywhere.isInitialized ? RunAnywhere.accelerationMode : null;
}

// Re-export for convenience
export { RunAnywhere, ModelManager, ModelCategory, VLMWorkerBridge };
