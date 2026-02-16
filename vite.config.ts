import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Copies WASM binaries and Sherpa-ONNX glue scripts from the
 * @runanywhere/web npm package into dist/assets/ so they're served
 * alongside the bundled JS at runtime.
 *
 * In dev mode, Vite serves node_modules directly so this only
 * matters for production builds.
 */
function copyWasmPlugin(): Plugin {
  const pkgWasm = path.resolve(__dir, 'node_modules/@runanywhere/web/wasm');

  return {
    name: 'copy-wasm',
    writeBundle(options) {
      const outDir = options.dir ?? path.resolve(__dir, 'dist');
      const assetsDir = path.join(outDir, 'assets');
      fs.mkdirSync(assetsDir, { recursive: true });

      // RACommons WASM binaries
      const racommonsFiles = [
        { src: path.join(pkgWasm, 'racommons.wasm'), dest: 'racommons.wasm' },
        { src: path.join(pkgWasm, 'racommons-webgpu.wasm'), dest: 'racommons-webgpu.wasm' },
        { src: path.join(pkgWasm, 'racommons.js'), dest: 'racommons.js' },
        { src: path.join(pkgWasm, 'racommons-webgpu.js'), dest: 'racommons-webgpu.js' },
      ];

      for (const { src, dest } of racommonsFiles) {
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(assetsDir, dest));
          const sizeMB = (fs.statSync(src).size / 1_000_000).toFixed(1);
          console.log(`  ✓ Copied ${dest} (${sizeMB} MB)`);
        } else {
          console.warn(`  ⚠ Not found: ${src}`);
        }
      }

      // Sherpa-ONNX: copy all files in sherpa/ subdirectory
      const sherpaDir = path.join(pkgWasm, 'sherpa');
      const sherpaOut = path.join(assetsDir, 'sherpa');
      if (fs.existsSync(sherpaDir)) {
        fs.mkdirSync(sherpaOut, { recursive: true });
        for (const file of fs.readdirSync(sherpaDir)) {
          const src = path.join(sherpaDir, file);
          fs.copyFileSync(src, path.join(sherpaOut, file));
          const sizeMB = (fs.statSync(src).size / 1_000_000).toFixed(1);
          console.log(`  ✓ Copied sherpa/${file} (${sizeMB} MB)`);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyWasmPlugin()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  assetsInclude: ['**/*.wasm'],
  worker: { format: 'es' },
});
