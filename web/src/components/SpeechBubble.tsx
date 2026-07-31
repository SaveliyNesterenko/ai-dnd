import { useEffect, useRef, useState } from "react";

import {
  TEXT_ONLY_CUE_DURATION_MS,
  type SpeechCue,
} from "../hooks/useSpeechPlayback";

export function SpeechBubble({
  cue,
  onComplete,
}: {
  cue: SpeechCue;
  onComplete: (cueId: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const retryPlaybackRef = useRef<(() => void) | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    let animationFrame = 0;
    let completionTimer = 0;
    let completed = false;
    let scrollStartedAt: number | null = null;

    const finish = () => {
      if (completed) return;
      completed = true;
      onComplete(cue.id);
    };

    const startScroll = (durationMs: number) => {
      window.cancelAnimationFrame(animationFrame);
      content.style.transform = "translate3d(0, 0, 0)";
      scrollStartedAt = null;
      const distance = Math.max(0, content.offsetHeight - viewport.clientHeight);
      if (distance === 0) return;

      const step = (timestamp: number) => {
        if (scrollStartedAt === null) scrollStartedAt = timestamp;
        const progress = Math.min((timestamp - scrollStartedAt) / durationMs, 1);
        content.style.transform = `translate3d(0, ${-distance * progress}px, 0)`;
        if (progress < 1) animationFrame = window.requestAnimationFrame(step);
      };
      animationFrame = window.requestAnimationFrame(step);
    };

    const startTextOnlyPlayback = () => {
      startScroll(TEXT_ONLY_CUE_DURATION_MS);
      completionTimer = window.setTimeout(finish, TEXT_ONLY_CUE_DURATION_MS);
    };

    if (!cue.audioUrl) {
      animationFrame = window.requestAnimationFrame(startTextOnlyPlayback);
    } else {
      const audio = new Audio();
      audioRef.current = audio;
      audio.preload = "auto";
      audio.onended = finish;
      audio.onerror = () => {
        audioRef.current = null;
        setAudioBlocked(false);
        startTextOnlyPlayback();
      };
      audio.onloadedmetadata = () => {
        const durationMs = audio.duration * 1000;
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
          startTextOnlyPlayback();
          return;
        }

        const startAudioPlayback = () => {
          void audio.play().then(
            () => {
              setAudioBlocked(false);
              startScroll(durationMs);
            },
            () => setAudioBlocked(true),
          );
        };
        retryPlaybackRef.current = startAudioPlayback;
        startAudioPlayback();
      };
      audio.src = cue.audioUrl;
      audio.load();
    }

    return () => {
      completed = true;
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(completionTimer);
      retryPlaybackRef.current = null;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
        audioRef.current.load();
        audioRef.current = null;
      }
      content.style.transform = "translate3d(0, 0, 0)";
    };
  }, [cue.audioUrl, cue.id, onComplete]);

  const description = cue.kind === "thought" ? "Мысль" : "Реплика";

  return (
    <>
      <div
        className={`speech-bubble ${cue.kind}`}
        role="status"
        aria-label={`${description} персонажа ${cue.actorName}`}
      >
        <div className="speech-bubble-viewport" ref={viewportRef}>
          <div className="speech-bubble-content" ref={contentRef}>
            {cue.text}
          </div>
        </div>
      </div>
      {audioBlocked ? (
        <button
          className="button speech-audio-unlock"
          type="button"
          onClick={() => retryPlaybackRef.current?.()}
        >
          Включить озвучку
        </button>
      ) : null}
    </>
  );
}
