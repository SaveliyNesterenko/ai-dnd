
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition;

function initializeSpeechRecognition(resultCallback, endCallback) {
    if (!SpeechRecognition) {
        console.error("Speech Recognition API is not supported in this browser.");
        return null;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU'; // Set language to Russian
    recognition.interimResults = true; // Get interim results

    recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';
        for (let i = 0; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }
        resultCallback(finalTranscript || interimTranscript);
    };

    recognition.onend = () => {
        if (endCallback) {
            endCallback();
        }
    };
    
    recognition.onerror = (event) => {
        console.error("Speech recognition error", event.error);
    };

    return {
        start: () => recognition.start(),
        stop: () => recognition.stop()
    };
}
