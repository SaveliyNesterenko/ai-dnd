import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef } from "react";

import { api } from "../../api/client";
import type { Campaign, CharacterGM, GameStateSnapshot } from "../../api/types";
import type { GmTheme } from "../../store/ui";
import { useToast } from "../../hooks/useToast";
import { describeError } from "../../utils/errors";
import { pluralTurns } from "../../utils/format";
import { EventFinalization } from "../EventFinalization";
import { CampaignPopover } from "./CampaignPopover";
import { CharacterPicker } from "./CharacterPicker";
import { ScenePopover } from "./ScenePopover";
import { ChevronDown, ClockGlyph, MoonGlyph, SunGlyph } from "./icons";

export type OpenPopover = "campaign" | "scene" | "characters" | null;

export function CommandBar({
  campaignId,
  campaigns,
  campaignSelectionPending,
  onSelectCampaign,
  onImportCampaignPack,
  campaignImportPending,
  snapshot,
  characters,
  spectatorCode,
  onToggleCharacter,
  characterSelectionPending,
  onChanged,
  openPopover,
  onOpenPopover,
  observerOpen,
  onToggleObserver,
  theme,
  onToggleTheme,
}: {
  campaignId: string;
  campaigns: Campaign[];
  campaignSelectionPending: boolean;
  onSelectCampaign: (campaignId: string) => void;
  onImportCampaignPack: (file: File) => void;
  campaignImportPending: boolean;
  snapshot: GameStateSnapshot;
  characters: CharacterGM[];
  spectatorCode?: string;
  onToggleCharacter: (characterId: string) => void;
  characterSelectionPending: boolean;
  onChanged: () => void;
  /* Состояние поповеров живёт в странице: «Выбрать персонажа» из композера и
     из ленты открывает тот же самый список, что и чип. */
  openPopover: OpenPopover;
  onOpenPopover: (popover: OpenPopover) => void;
  /* Ниже 1100px Наблюдатель уезжает в выдвижную панель — кнопка живёт здесь. */
  observerOpen: boolean;
  onToggleObserver: () => void;
  theme: GmTheme;
  onToggleTheme: () => void;
}) {
  const toast = useToast();
  const campaignRef = useRef<HTMLButtonElement>(null);
  const sceneRef = useRef<HTMLButtonElement>(null);
  const charactersRef = useRef<HTMLButtonElement>(null);

  const capabilities = useQuery({
    queryKey: ["capabilities"],
    queryFn: api.capabilities,
    staleTime: Infinity,
  });

  const scene = snapshot.scene;
  const finalizing = snapshot.active_event?.status === "finalizing";
  const onSceneCount = scene.characters.filter((state) => state.is_visible).length;
  const campaignName = campaigns.find((campaign) => campaign.id === campaignId)?.name ?? "—";
  const locationName =
    scene.locations.find((location) => location.id === scene.location_id)?.name ?? "Без карты";
  const trackName = scene.music_tracks.find((track) => track.id === scene.music_track_id)?.name;

  const startEvent = useMutation({
    mutationFn: () => api.startEvent(campaignId, "Новое игровое событие"),
    onSuccess: onChanged,
    onError: (error) =>
      toast.push({
        tone: "error",
        title: "Событие не запустилось",
        description: describeError(error),
      }),
  });

  const toggle = (popover: OpenPopover) =>
    onOpenPopover(openPopover === popover ? null : popover);

  return (
    <header className="command-bar">
      <div className="command-bar__zone">
        <button
          ref={campaignRef}
          type="button"
          className="chip"
          aria-expanded={openPopover === "campaign"}
          aria-label={`Кампания: ${campaignName}`}
          onClick={() => toggle("campaign")}
        >
          <span className="chip__dot" aria-hidden="true" />
          <span className="chip__value">{campaignName}</span>
          <span className="chip__aside mono">rev {snapshot.campaign.revision}</span>
          <ChevronDown size={12} />
        </button>
      </div>

      <div className="command-bar__zone">
        <button
          ref={sceneRef}
          type="button"
          className="chip"
          aria-expanded={openPopover === "scene"}
          aria-label="Настройки сцены"
          onClick={() => toggle("scene")}
        >
          <span className="chip__label">Сцена</span>
          <span className="chip__value">{locationName}</span>
          {trackName && (
            <span className="chip__aside">
              ♪ {trackName} {scene.music_volume}%
            </span>
          )}
          <ChevronDown size={12} />
        </button>

        <button
          ref={charactersRef}
          type="button"
          className="chip"
          aria-expanded={openPopover === "characters"}
          aria-label={`Персонажи на сцене: ${onSceneCount}`}
          onClick={() => toggle("characters")}
        >
          <span className="chip__label">Персонажи</span>
          <span className="count-pill">{onSceneCount}</span>
          <ChevronDown size={12} />
        </button>
      </div>

      <div className="command-bar__zone command-bar__zone--flow">
        <button
          type="button"
          className="chip command-bar__observer-toggle"
          aria-expanded={observerOpen}
          onClick={onToggleObserver}
        >
          <span className="chip__label">Наблюдатель</span>
        </button>

        <button
          type="button"
          className="theme-toggle"
          aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
          title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
          onClick={onToggleTheme}
        >
          {theme === "dark" ? <SunGlyph size={15} /> : <MoonGlyph size={15} />}
        </button>

        <ul className="capabilities" aria-label="Доступность внешних сервисов">
          <Capability label="LLM" enabled={capabilities.data?.llm_enabled} />
          <Capability label="STT" enabled={capabilities.data?.stt_enabled} />
          <TTSCapability
            status={capabilities.data?.tts.status}
            detail={capabilities.data?.tts.detail}
            campaignEnabled={snapshot.campaign.speech_enabled}
          />
        </ul>

        {snapshot.active_event ? (
          <div className="event-cta">
            <span className="event-cta__state">
              <ClockGlyph size={13} />
              Событие · {snapshot.active_event.turns.length}{" "}
              {pluralTurns(snapshot.active_event.turns.length)}
            </span>
            <EventFinalization
              campaignId={campaignId}
              snapshot={snapshot}
              onChanged={onChanged}
            />
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--gm"
            disabled={onSceneCount === 0 || startEvent.isPending}
            onClick={() => startEvent.mutate()}
          >
            {startEvent.isPending ? "Запускаем…" : "Запустить событие"}
          </button>
        )}
      </div>

      <CampaignPopover
        anchorRef={campaignRef}
        open={openPopover === "campaign"}
        onClose={() => onOpenPopover(null)}
        campaigns={campaigns}
        campaignId={campaignId}
        pending={campaignSelectionPending}
        onSelect={onSelectCampaign}
        onImport={onImportCampaignPack}
        importPending={campaignImportPending}
        spectatorCode={spectatorCode}
        spectatorsOnline={Boolean(spectatorCode)}
      />
      <ScenePopover
        anchorRef={sceneRef}
        open={openPopover === "scene"}
        onClose={() => onOpenPopover(null)}
        campaignId={campaignId}
        scene={scene}
        locked={finalizing}
        onChanged={onChanged}
      />
      <CharacterPicker
        anchorRef={charactersRef}
        open={openPopover === "characters"}
        onClose={() => onOpenPopover(null)}
        characters={characters}
        scene={scene}
        pending={characterSelectionPending}
        locked={finalizing}
        onToggle={onToggleCharacter}
      />
    </header>
  );
}

/**
 * У озвучки состояний больше двух, и лечатся они по-разному: выключена
 * настройкой — правится в .env, движка нет — пересборкой, выключена на кампании
 * — тумблером в панели озвучки. Бинарная лампочка все три случая сваливала в
 * «недоступен».
 */
function TTSCapability({
  status,
  detail,
  campaignEnabled,
}: {
  status: "ready" | "off" | "unavailable" | undefined;
  detail: string | null | undefined;
  campaignEnabled: boolean;
}) {
  if (status === undefined) {
    return <Capability label="TTS" enabled={undefined} />;
  }
  const muted = status === "ready" && !campaignEnabled;
  const state = muted ? "muted" : status === "ready" ? "on" : "off";
  const description = muted
    ? "выключена на кампании"
    : status === "ready"
      ? "работает"
      : (detail ?? "недоступна");
  return (
    <li className={`capability capability--${state}`}>
      <span aria-hidden="true" />
      <abbr title={`Озвучка ${description}`}>TTS</abbr>
    </li>
  );
}

function Capability({ label, enabled }: { label: string; enabled: boolean | undefined }) {
  const state = enabled === undefined ? "unknown" : enabled ? "on" : "off";
  const description =
    state === "unknown" ? "проверяется" : state === "on" ? "доступен" : "недоступен";
  return (
    <li className={`capability capability--${state}`}>
      <span aria-hidden="true" />
      <abbr title={`${label} ${description}`}>{label}</abbr>
    </li>
  );
}
