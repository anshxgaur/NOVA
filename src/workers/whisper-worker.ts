import { pipeline, env } from '@xenova/transformers';

// Skip local model checks since we are pulling from the Hugging Face CDN first
env.allowLocalModels = false;

let transcriber: any = null;

// Initialize the model
async function init() {
    if (transcriber) return;
    try {
        // We use whisper-tiny.en because it is extremely fast and perfect for browsers
        transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
        self.postMessage({ status: 'ready' });
    } catch (err) {
        self.postMessage({ status: 'error', error: String(err) });
    }
}

// Listen for audio data from the React frontend
self.addEventListener('message', async (e) => {
    if (e.data.type === 'init') {
        await init();
    }

    if (e.data.type === 'transcribe') {
        if (!transcriber) return;

        try {
            // Process the audio blob
            const output = await transcriber(e.data.audio, {
                chunk_length_s: 30,
                stride_length_s: 5,
                language: 'english',
                task: 'transcribe',
            });

            self.postMessage({
                status: 'complete',
                text: output.text.trim()
            });
        } catch (err) {
            self.postMessage({ status: 'error', error: String(err) });
        }
    }
});