import { useMutation } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { api } from "../../api/client";
import { useJobRunner } from "../../hooks/useJobPolling";
import { useToast } from "../../hooks/useToast";
import { describeError } from "../../utils/errors";
import { ErrorNotice } from "../ErrorNotice";
import { MicGlyph, SendGlyph } from "./icons";

// Порядок важен: opus в ogg распознаётся лучше, webm остаётся запасным вариантом.
const PREFERRED_MIME_TYPES = [
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/webm;codecs=opus",
  "audio/webm",
];

const MAX_FIELD_HEIGHT = 150;
const LEVEL_BARS = 14;

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function extensionFor(mimeType: string): string {
  return mimeType.includes("ogg") ? "ogg" : "webm";
}

function describeMicError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Браузер не дал доступ к микрофону. Разрешите запись звука для этой страницы и попробуйте снова.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Микрофон не найден. Подключите устройство записи и попробуйте снова.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Не удалось получить доступ к микрофону.";
}

export function VoiceDock({
  campaignId,
  eventId,
  onChanged,
}: {
  campaignId: string;
  eventId: string | undefined;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [micError, setMicError] = useState<string>();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  /* Поле растёт под текст, но не съедает лог: дальше появляется прокрутка. */
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(MAX_FIELD_HEIGHT, field.scrollHeight)}px`;
  }, [text]);

  const transcribe = useJobRunner({
    start: (blob: Blob) => {
      const mediaType = (blob.type || "audio/webm").split(";", 1)[0]!;
      const file = new File([blob], `gm-speech.${extensionFor(mediaType)}`, { type: mediaType });
      return api.transcribeVoice(file);
    },
    fetchJob: (jobId) => api.getVoiceJob(jobId),
    parse: (job) => {
      const transcript = job.output_data?.transcript;
      if (typeof transcript !== "string" || !transcript.trim()) {
        throw new Error("Речь не распознана. Попробуйте записать ещё раз.");
      }
      return transcript.trim();
    },
    describeFailure: (job) => `Не удалось расшифровать запись: ${job.error_code ?? job.status}`,
    timeoutMessage: "Расшифровка не завершилась вовремя.",
    onSuccess: (transcript) =>
      setText((previous) => (previous.trim() ? `${previous.trim()} ${transcript}` : transcript)),
  });

  const sendToLog = useMutation({
    mutationFn: () => {
      if (!eventId) throw new Error("Нет активного события.");
      return api.createTurn(campaignId, eventId, {
        character_id: null,
        actor_name: "Game Master",
        actor_role: "gm",
        action: text.trim(),
        roll_dice: false,
      });
    },
    onSuccess: () => {
      setText("");
      onChanged();
    },
  });

  useEffect(() => {
    if (!transcribe.error) return;
    toast.push({
      tone: "error",
      title: "Расшифровка не удалась",
      description: describeError(transcribe.error),
    });
  }, [toast, transcribe.error]);

  useEffect(() => {
    if (!sendToLog.error) return;
    toast.push({
      tone: "error",
      title: "Реплика не отправлена",
      description: describeError(sendToLog.error),
    });
  }, [sendToLog.error, toast]);

  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
        recorder.stream.getTracks().forEach((track) => track.stop());
      }
    },
    [],
  );

  const startRecording = async () => {
    setMicError(undefined);
    transcribe.reset();
    sendToLog.reset();
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setMicError("Браузер не поддерживает запись звука.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      setMicError(describeMicError(error));
      return;
    }
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => setMicError("Запись прервалась из-за ошибки микрофона.");
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      setIsRecording(false);
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      if (blob.size === 0) {
        setMicError("Запись оказалась пустой. Попробуйте ещё раз.");
        return;
      }
      transcribe.run(blob);
    };
    recorderRef.current = recorder;
    setIsRecording(true);
    recorder.start();
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  };

  const hint = isRecording
    ? "Идёт запись — нажмите ещё раз, чтобы остановить и расшифровать"
    : transcribe.isPending
      ? "Расшифровка…"
      : eventId
        ? "Ctrl+Enter — отправить в лог"
        : "Запустите игровое событие, чтобы отправлять реплики в лог.";

  const canSend = Boolean(eventId) && !isRecording && Boolean(text.trim()) && !sendToLog.isPending;

  return (
    <section className="voice-dock" aria-label="Запись речи ГМ">
      <div className="voice-dock__row">
        <button
          type="button"
          className={`record-button${isRecording ? " is-recording" : ""}`}
          aria-label={isRecording ? "Остановить запись" : "Запись голоса"}
          aria-pressed={isRecording}
          disabled={transcribe.isPending}
          onClick={() => (isRecording ? stopRecording() : void startRecording())}
        >
          <MicGlyph size={16} />
        </button>

        {isRecording && (
          <span className="level-meter" aria-hidden="true">
            {Array.from({ length: LEVEL_BARS }, (_, index) => (
              <i key={index} style={{ animationDelay: `${index * 70}ms` }} />
            ))}
          </span>
        )}

        <textarea
          ref={fieldRef}
          className="voice-dock__field"
          rows={1}
          aria-label="Распознанный текст GM"
          placeholder="Реплика ГМ — говорите или печатайте…"
          value={text}
          disabled={isRecording || transcribe.isPending}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && canSend) {
              event.preventDefault();
              sendToLog.mutate();
            }
          }}
        />

        <button
          type="button"
          className="send-button"
          aria-label="Отправить в лог"
          title="Отправить в лог · Ctrl+Enter"
          disabled={!canSend}
          onClick={() => sendToLog.mutate()}
        >
          <SendGlyph size={16} />
        </button>
      </div>

      <p className="voice-dock__hint" aria-live="polite">
        {hint}
      </p>
      {micError && <ErrorNotice error={new Error(micError)} title="Микрофон недоступен" />}
    </section>
  );
}
