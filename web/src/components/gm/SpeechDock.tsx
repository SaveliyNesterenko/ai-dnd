import { useMutation, useQuery } from "@tanstack/react-query";

import { api } from "../../api/client";
import type { CampaignSummary } from "../../api/generated/types.gen";
import { useToast } from "../../hooks/useToast";
import type { SpeechQueue } from "../../hooks/useSpeechQueue";
import { describeError } from "../../utils/errors";
import { SpeakerGlyph, SpeakerOffGlyph, StopGlyph } from "./icons";

/**
 * Выход консоли, симметричный входу: VoiceDock — микрофон ГМ-а, здесь —
 * состояние и рычаги озвучки моделей. Отслеживание без рычагов быстро надоедает,
 * поэтому очередь и тумблеры живут в одной полосе.
 */
export function SpeechDock({
  campaignId,
  campaign,
  queue,
  onChanged,
}: {
  campaignId: string;
  campaign: CampaignSummary;
  queue: SpeechQueue;
  onChanged: () => void;
}) {
  const toast = useToast();
  const capabilities = useQuery({
    queryKey: ["capabilities"],
    queryFn: api.capabilities,
    staleTime: Infinity,
  });

  const settings = useMutation({
    mutationFn: (input: Parameters<typeof api.updateSpeechSettings>[1]) =>
      api.updateSpeechSettings(campaignId, input),
    onSuccess: onChanged,
    onError: (error) =>
      toast.push({
        tone: "error",
        title: "Настройка озвучки не сохранилась",
        description: describeError(error),
      }),
  });

  const skip = useMutation({
    mutationFn: () => api.skipSpeech(campaignId, queue.current?.turnId ?? null),
    onError: (error) =>
      toast.push({
        tone: "error",
        title: "Реплику не удалось прервать",
        description: describeError(error),
      }),
  });

  const engine = capabilities.data?.tts;
  const state = engineState(engine?.status, campaign.speech_enabled);

  return (
    <section className="speech-dock" aria-label="Озвучка реплик моделей">
      <div className="speech-dock__row">
        <span className={`speech-dock__state speech-dock__state--${state.tone}`}>
          {state.tone === "ready" ? <SpeakerGlyph size={14} /> : <SpeakerOffGlyph size={14} />}
          <span>{state.label}</span>
        </span>

        <Toggle
          label="Озвучка"
          title={
            campaign.speech_enabled
              ? "Выключить синтез — реплики продолжат приходить зрителю текстом"
              : "Включить синтез реплик"
          }
          checked={campaign.speech_enabled}
          disabled={settings.isPending}
          onChange={(value) => settings.mutate({ speech_enabled: value })}
        />
        <Toggle
          label="Мысли"
          title="Озвучивать ли мысль персонажа помимо реплики"
          checked={campaign.speech_speak_thoughts}
          disabled={settings.isPending || !campaign.speech_enabled}
          onChange={(value) => settings.mutate({ speech_speak_thoughts: value })}
        />

        <button
          type="button"
          className="mini-button speech-dock__skip"
          title="Оборвать реплику, которая играет у зрителей"
          disabled={skip.isPending}
          onClick={() => skip.mutate()}
        >
          <StopGlyph size={11} />
          Прервать
        </button>
      </div>

      <p className="speech-dock__hint" aria-live="polite">
        {describeQueue(queue, engine?.detail ?? null, state.tone)}
      </p>
    </section>
  );
}

function Toggle({
  label,
  title,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  title: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      className={`speech-toggle${checked ? " is-on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="speech-toggle__label">{label}</span>
      <span className="switch" aria-hidden="true" />
    </button>
  );
}

type EngineTone = "ready" | "muted" | "off";

function engineState(
  status: string | undefined,
  campaignEnabled: boolean,
): { tone: EngineTone; label: string } {
  if (status === undefined) return { tone: "off", label: "Проверяем движок…" };
  if (status === "unavailable") return { tone: "off", label: "Движка нет" };
  if (status === "off") return { tone: "off", label: "Выключена в настройках" };
  if (!campaignEnabled) return { tone: "muted", label: "Выключена на кампании" };
  return { tone: "ready", label: "Готова" };
}

function describeQueue(queue: SpeechQueue, detail: string | null, tone: EngineTone): string {
  if (queue.current) {
    const tail = queue.waiting > 0 ? ` · в очереди ещё ${queue.waiting}` : "";
    return `Синтезируем реплику: ${queue.current.actorName}${tail}`;
  }
  if (queue.lastFailure) {
    return `Последняя озвучка не удалась: ${queue.lastFailure.actorName}. Переозвучить можно из лога.`;
  }
  if (tone !== "ready" && detail) return detail;
  if (tone === "muted") return "Реплики доходят до зрителя текстом.";
  return "Очередь пуста.";
}
