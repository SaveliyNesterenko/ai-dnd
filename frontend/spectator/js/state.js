import { showSpeechBubble, animateScrollTransform, stopAnimations, showDiceRoll } from './ui.js';
import { API_BASE_URL } from './api.js';

let speechEventsByStep = new Map();
let pendingDiceRolls = [];
let activePlaybackSession = null;
let isProcessing = false;
const spectatorSessionStartedAtMs = Date.now();

function getStepBucket(step) {
    if (!speechEventsByStep.has(step)) {
        speechEventsByStep.set(step, { thought: null, action: null });
    }
    return speechEventsByStep.get(step);
}

function clearPlaybackSession() {
    activePlaybackSession = null;
    isProcessing = false;
}

function isStepComplete(session) {
    const thoughtDone = !session.expectsThought || session.playedThought;
    const actionDone = !session.expectsAction || session.playedAction;
    return thoughtDone && actionDone;
}

export function handleDiceRollEvent(rollValue) {
    if (typeof rollValue !== 'number') return;
    pendingDiceRolls.push(rollValue);
}

export function handleSpeechEvent(data) {
    const step = Number(data?.step);
    if (!Number.isFinite(step)) return;

    const bucket = getStepBucket(step);
    if (data.type === 'thought') {
        bucket.thought = data;
    } else if (data.type === 'action') {
        bucket.action = data;
    } else {
        return;
    }

    if (activePlaybackSession?.step === step) {
        processPlaybackSession();
    }
}

export function handleSpeechPlaybackTrigger(data) {
    const step = Number(data?.step);
    const triggeredAtMs = Number(data?.triggered_at) * 1000;
    if (!Number.isFinite(step)) return;
    if (Number.isFinite(triggeredAtMs) && triggeredAtMs < spectatorSessionStartedAtMs) {
        console.log(`Ignoring stale playback trigger for step ${step}.`);
        return;
    }

    if (activePlaybackSession?.step === step) {
        processPlaybackSession();
        return;
    }

    if (activePlaybackSession && activePlaybackSession.step !== step) {
        console.warn(`Playback for step ${step} ignored because step ${activePlaybackSession.step} is still active.`);
        return;
    }

    activePlaybackSession = {
        step,
        expectsThought: Boolean(data?.expects_thought),
        expectsAction: Boolean(data?.expects_action),
        playedThought: false,
        playedAction: false
    };
    processPlaybackSession();
}

async function processPlaybackSession() {
    if (isProcessing || !activePlaybackSession) {
        return;
    }

    const { step } = activePlaybackSession;
    const bucket = speechEventsByStep.get(step) || { thought: null, action: null };
    let nextEvent = null;

    if (!activePlaybackSession.playedThought && bucket.thought) {
        nextEvent = bucket.thought;
        activePlaybackSession.playedThought = true;
    } else if (!activePlaybackSession.playedAction && bucket.action) {
        nextEvent = bucket.action;
        activePlaybackSession.playedAction = true;
    }

    if (!nextEvent) {
        if (isStepComplete(activePlaybackSession)) {
            speechEventsByStep.delete(step);
            clearPlaybackSession();
        }
        return;
    }

    isProcessing = true;
    await executeSpeechEvent(nextEvent);
    isProcessing = false;

    if (!activePlaybackSession || activePlaybackSession.step !== step) {
        return;
    }

    if (isStepComplete(activePlaybackSession)) {
        speechEventsByStep.delete(step);
        clearPlaybackSession();
        return;
    }

    processPlaybackSession();
}

function executeSpeechEvent(data) {
    return new Promise(resolve => {
        const { character, text, type, audio_url } = data;

        console.log(`Executing speech event for ${character}: ${type} (step ${data.step})`);

        const bubbleElements = showSpeechBubble(character, text, type);
        if (!bubbleElements) {
            console.error(`Could not create speech bubble for ${character}.`);
            resolve();
            return;
        }

        const cleanupAndResolve = () => {
            stopAnimations();
            bubbleElements.wrapper.remove();
            if (type === 'action' && pendingDiceRolls.length > 0) {
                const nextRoll = pendingDiceRolls.shift();
                showDiceRoll(nextRoll);
            }
            resolve();
        };

        if (audio_url) {
            const audio = new Audio(`${API_BASE_URL}/${audio_url}`);

            audio.onloadedmetadata = () => {
                animateScrollTransform(bubbleElements.wrapper, bubbleElements.content, audio.duration);
                audio.play().catch(error => {
                    console.error('Error playing audio:', error);
                    cleanupAndResolve();
                });
            };

            audio.onended = cleanupAndResolve;
            audio.onerror = (error) => {
                console.error('Audio loading error:', error?.message || error);
                cleanupAndResolve();
            };
        } else {
            const fixedDurationInSeconds = 15;
            animateScrollTransform(bubbleElements.wrapper, bubbleElements.content, fixedDurationInSeconds);
            setTimeout(cleanupAndResolve, fixedDurationInSeconds * 1000);
        }
    });
}
