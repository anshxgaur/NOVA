/**
 * NOVA V5 - PERFORMANCE OPTIMIZED EDITION 🚀
 */

import {
  RunAnywhere,
  SDKEnvironment,
  ModelCategory,
  LLMFramework,
  type CompactModelDef,
} from '@runanywhere/web';

import { LlamaCPP } from '@runanywhere/web-llamacpp';
import { ONNX } from '@runanywhere/web-onnx';

// ⚡ FAST + LIGHT MODEL
const MODELS: CompactModelDef[] = [
  {
    id: 'smollm2-135m-speed',
    name: 'Nova Core ⚡',
    repo: 'HuggingFaceTB/SmolLM2-135M-Instruct-GGUF',

    // 🔥 Faster quantization (much better than Q8)
    files: ['smollm2-135m-instruct-q4_k_m.gguf'],

    framework: LLMFramework.LlamaCpp,
    modality: ModelCategory.Language,

    // 🔥 Lower memory = faster load
    memoryRequirement: 60_000_000,
  }
];

// 🔒 Prevent multiple initializations
let _initPromise: Promise<void> | null = null;

export async function initSDK(): Promise<void> {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    console.log("NOVA: Initializing SDK...");

    await RunAnywhere.initialize({
      environment: SDKEnvironment.Production,

      // ⚡ Turn OFF debug for performance
      debug: false,
    });

    // 🚀 Try WebGPU first (fastest)
    try {
      await LlamaCPP.register({
        acceleration: 'webgpu',
      });

      console.log("NOVA: WebGPU Engaged 🚀");
    } catch (error) {
      console.warn("NOVA: WebGPU failed → falling back to CPU 🛡️");

      await LlamaCPP.register({
        acceleration: 'cpu',
      });
    }

    // 🔄 Register ONNX (for other models if needed)
    await ONNX.register();

    // ✅ Correct (no extra args — matches your SDK)
    await RunAnywhere.registerModels(MODELS);

    console.log("NOVA: Models ready ⚡");
  })();

  return _initPromise;
}

// 🔍 Helper to check acceleration mode
export function getAccelerationMode(): string | null {
  return LlamaCPP.isRegistered ? LlamaCPP.accelerationMode : null;
}

export { RunAnywhere, ModelCategory };

// 🔌 Export ModelManager
import { ModelManager as SDKModelManager } from '@runanywhere/web';
export const ModelManager = SDKModelManager;
