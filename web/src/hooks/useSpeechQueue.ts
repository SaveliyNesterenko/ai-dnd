import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { api } from "../api/client";
import type { BackgroundJobView, TurnView } from "../api/generated/types.gen";

/**
 * Синтез идёт фоновой задачей по одной реплике за раз, поэтому очередь реальна
 * и ГМ должен её видеть. Единственный источник правды — список задач кампании:
 * из него получаются и очередь, и статус конкретной реплики в логе.
 */

export type SpeechCueKind = "thought" | "action";
export type SpeechCueState = "voiced" | "pending" | "silent";

/** Почему реплика осталась без звука. Значения приходят из `output_data`. */
export type SpeechReason =
  | "speech_disabled"
  | "thoughts_muted"
  | "no_voice_sample"
  | "tts_unavailable"
  | "synthesis_failed";

const REASON_LABELS: Record<SpeechReason, string> = {
  speech_disabled: "Озвучка выключена для кампании",
  thoughts_muted: "Мысли не озвучиваются",
  no_voice_sample: "У персонажа нет образца голоса",
  tts_unavailable: "Движок озвучки недоступен",
  synthesis_failed: "Синтез не удался",
};

const ACTIVE_STATUSES = new Set(["queued", "running"]);
const BROKEN_STATUSES = new Set(["failed", "degraded"]);

export function describeSpeechReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return REASON_LABELS[reason as SpeechReason] ?? "Озвучки нет";
}

export interface SpeechQueueEntry {
  jobId: string;
  turnId: string;
  actorName: string;
  running: boolean;
}

export interface SpeechCueStatus {
  state: SpeechCueState;
  audioUrl: string | null;
  reason: string | null;
}

export interface SpeechQueue {
  /** Очередь как она есть: сначала та реплика, что синтезируется сейчас. */
  entries: SpeechQueueEntry[];
  current: SpeechQueueEntry | null;
  waiting: number;
  /** Ход, у которого последняя задача озвучки сломалась. */
  lastFailure: SpeechQueueEntry | null;
  isLoading: boolean;
  refresh: () => void;
  cueStatus: (turn: TurnView, kind: SpeechCueKind) => SpeechCueStatus;
}

function entryOf(job: BackgroundJobView): SpeechQueueEntry | null {
  const input = job.input_data ?? {};
  const turnId = input.turn_id;
  if (typeof turnId !== "string") return null;
  return {
    jobId: job.id,
    turnId,
    actorName: typeof input.actor_name === "string" ? input.actor_name : "—",
    running: job.status === "running",
  };
}

function reasonsOf(job: BackgroundJobView): Record<string, string> {
  const reasons = job.output_data?.reasons;
  if (!reasons || typeof reasons !== "object") return {};
  return reasons as Record<string, string>;
}

export function useSpeechQueue(campaignId: string | undefined): SpeechQueue {
  const queryClient = useQueryClient();
  const jobs = useQuery({
    queryKey: ["speech-jobs", campaignId],
    queryFn: () => api.speechJobs(campaignId!),
    enabled: Boolean(campaignId),
    /* Пока очередь не пуста — опрашиваем часто, дальше редкий фон: события
       realtime всё равно сбрасывают кеш, опрос лишь страхует от их потери. */
    refetchInterval: (query) => {
      const data = query.state.data ?? [];
      return data.some((job) => ACTIVE_STATUSES.has(job.status)) ? 1_500 : 15_000;
    },
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["speech-jobs", campaignId] });
  }, [campaignId, queryClient]);

  return useMemo(() => {
    /* Список приходит новыми вперёд — очередь читается наоборот. */
    const all = [...(jobs.data ?? [])].reverse();
    const entries = all
      .filter((job) => ACTIVE_STATUSES.has(job.status))
      .map(entryOf)
      .filter((entry): entry is SpeechQueueEntry => entry !== null);
    const current = entries.find((entry) => entry.running) ?? entries[0] ?? null;
    const lastFailure =
      all
        .filter((job) => BROKEN_STATUSES.has(job.status))
        .map(entryOf)
        .filter((entry): entry is SpeechQueueEntry => entry !== null)
        .at(-1) ?? null;

    const pendingTurnIds = new Set(entries.map((entry) => entry.turnId));
    /* Причина берётся из последней завершённой задачи по этому ходу:
       переозвучка должна вытеснять прежний вердикт. */
    const reasonsByTurn = new Map<string, Record<string, string>>();
    for (const job of all) {
      const entry = entryOf(job);
      if (!entry || job.status !== "succeeded") continue;
      reasonsByTurn.set(entry.turnId, reasonsOf(job));
    }

    const cueStatus = (turn: TurnView, kind: SpeechCueKind): SpeechCueStatus => {
      const audioUrl = kind === "thought" ? turn.thought_audio_url : turn.action_audio_url;
      /* Идущий синтез важнее прежнего звука: значок отвечает на вопрос «что
         происходит сейчас», иначе переозвучка выглядит как бездействие. */
      if (pendingTurnIds.has(turn.id)) return { state: "pending", audioUrl, reason: null };
      if (audioUrl) return { state: "voiced", audioUrl, reason: null };
      return {
        state: "silent",
        audioUrl: null,
        reason: describeSpeechReason(reasonsByTurn.get(turn.id)?.[kind]),
      };
    };

    return {
      entries,
      current,
      waiting: Math.max(0, entries.length - 1),
      lastFailure,
      isLoading: jobs.isPending,
      refresh,
      cueStatus,
    };
  }, [jobs.data, jobs.isPending, refresh]);
}
