/**
 * VLM Web Worker entry point.
 *
 * This file is bundled by Vite as a standalone worker chunk via the
 * `?worker&url` import in runanywhere.ts. All VLM inference runs off
 * the main thread so the camera and UI stay responsive.
 */
import { startVLMWorkerRuntime } from '@runanywhere/web';

startVLMWorkerRuntime();
