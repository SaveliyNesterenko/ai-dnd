import { showSpeechBubble, animateScrollTransform, stopAnimations } from './ui.js';
import { API_BASE_URL } from './api.js';

let speechQueue = [];
let speechDataStore = {};
let isProcessingQueue = false;

export function addTextUpdate(data) {
    const { step, character, type, text } = data;

    if (!speechDataStore[step]) {
        speechDataStore[step] = { character: character };
        speechQueue.push(step);
    }
    if (!speechDataStore[step][type]) {
        speechDataStore[step][type] = {};
    }
    speechDataStore[step][type].text = text;
    console.log(`Cached text for step ${step}, type ${type}`);
    processSpeechQueue();
}

export function addAudioUpdate(data) {
    const { step, type, audio_url } = data;
    if (speechDataStore[step] && speechDataStore[step][type]) {
        speechDataStore[step][type].audio_url = audio_url;
        console.log(`Cached audio_url for step ${step}, type ${type}`);
    } else {
        if (!speechDataStore[step]) speechDataStore[step] = {};
        if (!speechDataStore[step][type]) speechDataStore[step][type] = {};
        speechDataStore[step][type].audio_url = audio_url;
    }
}

async function playPart(step, type) {
    return new Promise(async (resolve) => {
        let partData;
        while (!(partData = speechDataStore[step]?.[type]) || !partData.text || !partData.audio_url) {
            await new Promise(r => setTimeout(r, 100));
        }

        const characterId = speechDataStore[step].character;
        const bubbleElements = showSpeechBubble(characterId, partData.text, type);
        if (!bubbleElements) {
            console.error(`Could not create speech bubble for ${characterId}.`);
            resolve();
            return;
        }

        const audio = new Audio(`${API_BASE_URL}/${partData.audio_url}`);
        
        const cleanupAndResolve = () => {
            stopAnimations();
            bubbleElements.wrapper.remove();
            if (type === 'thought') {
                setTimeout(resolve, 1000);
            } else {
                resolve();
            }
        };

        audio.onloadedmetadata = () => {
            animateScrollTransform(bubbleElements.wrapper, bubbleElements.content, audio.duration);
            audio.play().catch(e => {
                console.error("Error playing audio:", e);
                cleanupAndResolve();
            });
        };
        
        audio.onended = cleanupAndResolve;
        audio.onerror = (e) => { 
            console.error("Audio error:", e.message);
            cleanupAndResolve();
        };
    });
}

async function processSpeechQueue() {
    if (isProcessingQueue || speechQueue.length === 0) return;
    isProcessingQueue = true;

    const step = speechQueue.shift();
    console.log(`Processing step ${step}`);

    if (speechDataStore[step]?.thought) {
        await playPart(step, 'thought');
    }
    if (speechDataStore[step]?.action) {
        await playPart(step, 'action');
    }

    console.log(`Finished processing step ${step}`);
    isProcessingQueue = false;
    processSpeechQueue();
}
