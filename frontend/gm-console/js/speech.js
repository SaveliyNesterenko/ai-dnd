
const preferredMimeTypes = [
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/webm;codecs=opus',
    'audio/webm'
];

let mediaRecorder = null;
let mediaStream = null;
let chunks = [];
let isRecording = false;

function pickMimeType() {
    if (!window.MediaRecorder) return '';
    for (const type of preferredMimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
}

function extensionFromMime(mimeType) {
    if (!mimeType) return 'webm';
    if (mimeType.includes('ogg')) return 'ogg';
    if (mimeType.includes('webm')) return 'webm';
    if (mimeType.includes('wav')) return 'wav';
    if (mimeType.includes('opus')) return 'opus';
    return 'webm';
}

async function transcribeBlob(blob, mimeType) {
    const formData = new FormData();
    const ext = extensionFromMime(mimeType || blob.type);
    formData.append('file', blob, `speech.${ext}`);

    const response = await fetch('/api/transcribe_gm_audio', {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
            const err = await response.json();
            detail = err.detail || detail;
        } catch (e) {}
        throw new Error(detail);
    }

    const data = await response.json();
    return data.text || '';
}

function initializeSpeechRecognition(resultCallback, endCallback) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error("Audio recording is not supported in this browser.");
        return null;
    }

    return {
        start: async () => {
            if (isRecording) return;
            try {
                mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const mimeType = pickMimeType();
                mediaRecorder = mimeType
                    ? new MediaRecorder(mediaStream, { mimeType })
                    : new MediaRecorder(mediaStream);
                chunks = [];
                isRecording = true;

                mediaRecorder.ondataavailable = (event) => {
                    if (event.data && event.data.size > 0) {
                        chunks.push(event.data);
                    }
                };

                mediaRecorder.onerror = (event) => {
                    console.error("MediaRecorder error", event.error);
                };

                mediaRecorder.onstop = async () => {
                    const finalMime = mediaRecorder?.mimeType || mimeType || '';
                    const blob = new Blob(chunks, { type: finalMime || 'audio/webm' });
                    chunks = [];

                    if (mediaStream) {
                        mediaStream.getTracks().forEach(track => track.stop());
                        mediaStream = null;
                    }

                    try {
                        const text = await transcribeBlob(blob, finalMime);
                        resultCallback(text);
                    } catch (error) {
                        console.error("Transcription error", error);
                    } finally {
                        isRecording = false;
                        if (endCallback) endCallback();
                    }
                };

                mediaRecorder.start();
            } catch (error) {
                console.error("Failed to start audio capture", error);
                isRecording = false;
                if (endCallback) endCallback();
            }
        },
        stop: () => {
            if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
            mediaRecorder.stop();
        }
    };
}
