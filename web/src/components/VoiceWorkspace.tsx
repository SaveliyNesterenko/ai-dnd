import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import { ErrorNotice } from "./ErrorNotice";

// Порядок важен: opus в ogg распознаётся лучше, webm остаётся запасным вариантом.
const PREFERRED_MIME_TYPES = [
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/webm;codecs=opus",
  "audio/webm",
];

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

export function VoiceWorkspace({
  campaignId,
  eventId,
  onChanged,
}: {
  campaignId: string;
  eventId: string | undefined;
  onChanged: () => void;
}) {
  const [text, setText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [micError, setMicError] = useState<string>();
  const recorderRef = useRef<MediaRecorder | null>(null);

  const transcribe = useMutation({
    mutationFn: async (blob: Blob) => {
      const mediaType = (blob.type || "audio/webm").split(";", 1)[0]!;
      const file = new File([blob], `gm-speech.${extensionFor(mediaType)}`, {
        type: mediaType,
      });
      const job = await api.transcribeVoice(file);
      for (let attempt = 0; attempt < 180; attempt += 1) {
        const current = await api.getVoiceJob(job.id);
        if (current.status === "succeeded") {
          const transcript = current.output_data?.transcript;
          if (typeof transcript !== "string" || !transcript.trim()) {
            throw new Error("Речь не распознана. Попробуйте записать ещё раз.");
          }
          return transcript.trim();
        }
        if (["failed", "degraded", "cancelled"].includes(current.status)) {
          throw new Error(
            `Не удалось расшифровать запись: ${current.error_code ?? current.status}`,
          );
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      throw new Error("Расшифровка не завершилась вовремя.");
    },
    onSuccess: (transcript) => {
      setText((previous) => (previous.trim() ? `${previous.trim()} ${transcript}` : transcript));
    },
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
    recorder.onerror = () => {
      setMicError("Запись прервалась из-за ошибки микрофона.");
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      setIsRecording(false);
      const blob = new Blob(chunks, {
        type: recorder.mimeType || mimeType || "audio/webm",
      });
      if (blob.size === 0) {
        setMicError("Запись оказалась пустой. Попробуйте ещё раз.");
        return;
      }
      transcribe.mutate(blob);
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

  const status = isRecording
    ? "Идёт запись"
    : transcribe.isPending
      ? "Расшифровка…"
      : "Готово к записи";

  return (
    <section className="voice-workspace">
      <div className="panel__header">
        <div>
          <span className="eyebrow">Голос GM</span>
          <h2>Запись речи</h2>
        </div>
        <span aria-live="polite">{status}</span>
      </div>
      <div className="voice-workspace__body">
        <textarea
          aria-label="Распознанный текст GM"
          placeholder="Нажмите «Запись голоса» и говорите — распознанный текст появится здесь."
          value={text}
          disabled={isRecording || transcribe.isPending}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="voice-workspace__actions">
          <button
            className={`button button--quiet${isRecording ? " button--recording" : ""}`}
            type="button"
            aria-pressed={isRecording}
            disabled={transcribe.isPending}
            onClick={() => {
              if (isRecording) {
                stopRecording();
              } else {
                void startRecording();
              }
            }}
          >
            {isRecording ? "Остановить запись" : "Запись голоса"}
          </button>
          <button
            className="button"
            type="button"
            disabled={!eventId || isRecording || !text.trim() || sendToLog.isPending}
            onClick={() => sendToLog.mutate()}
          >
            {sendToLog.isPending ? "Отправляем…" : "Отправить в лог"}
          </button>
        </div>
        {!eventId && (
          <span className="voice-workspace__hint">
            Запустите игровое событие, чтобы отправлять реплики в лог.
          </span>
        )}
        {micError && <ErrorNotice error={new Error(micError)} title="Микрофон недоступен" />}
        {(transcribe.error ?? sendToLog.error) && (
          <ErrorNotice error={transcribe.error ?? sendToLog.error} />
        )}
      </div>
    </section>
  );
}
