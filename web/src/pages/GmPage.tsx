import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { api, ApiError } from "../api/client";
import type {
  CharacterGM,
  GameStateSnapshot,
  ObserverProposal,
} from "../api/types";
import { ErrorNotice } from "../components/ErrorNotice";
import { ActorHeader } from "../components/gm/ActorHeader";
import { ColumnResizer } from "../components/gm/ColumnResizer";
import { CharacterStrip } from "../components/gm/CharacterStrip";
import { CommandBar, type OpenPopover } from "../components/gm/CommandBar";
import { EventLog } from "../components/gm/EventLog";
import { ObserverPanel } from "../components/gm/ObserverPanel";
import { ShortcutsDialog } from "../components/gm/ShortcutsDialog";
import { TurnComposer } from "../components/gm/TurnComposer";
import { TurnFlowStrip, type TurnStage } from "../components/gm/TurnFlowStrip";
import { VoiceDock } from "../components/gm/VoiceDock";
import { useHotkeys } from "../hooks/useHotkeys";
import { useJobRunner } from "../hooks/useJobPolling";
import { useRealtime } from "../hooks/useRealtime";
import { useToast } from "../hooks/useToast";
import { useFlowStore } from "../store/flow";
import { useUiStore } from "../store/ui";
import { describeError } from "../utils/errors";

export default function GmPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [proposal, setProposal] = useState<ObserverProposal | null>(null);
  const [observerTurnId, setObserverTurnId] = useState<string>();
  const [appliedForTurnId, setAppliedForTurnId] = useState<string>();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>();
  const [openPopover, setOpenPopover] = useState<OpenPopover>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [observerDrawerOpen, setObserverDrawerOpen] = useState(false);

  const selectedCharacterId = useUiStore((state) => state.selectedCharacterId);
  const selectCharacter = useUiStore((state) => state.selectCharacter);
  const leftWidth = useUiStore((state) => state.leftWidth);
  const rightWidth = useUiStore((state) => state.rightWidth);
  const setColumnWidth = useUiStore((state) => state.setColumnWidth);
  const toggleStrip = useUiStore((state) => state.toggleStrip);

  const session = useQuery({ queryKey: ["gm-session"], queryFn: api.gmSession, retry: false });
  const campaigns = useQuery({ queryKey: ["campaigns"], queryFn: api.campaigns });
  const defaultCampaignId =
    campaigns.data?.find((campaign) => campaign.is_active)?.id ?? campaigns.data?.[0]?.id;
  const campaignId = selectedCampaignId ?? defaultCampaignId;

  const activateCampaign = useMutation({
    mutationFn: (nextCampaignId: string) => api.activateCampaign(nextCampaignId),
    onSuccess: (campaign) => {
      setProposal(null);
      selectCharacter(null);
      setSelectedCampaignId(campaign.id);
      void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (error) =>
      toast.push({
        tone: "error",
        title: "Кампания не переключилась",
        description: describeError(error),
      }),
  });

  const snapshot = useQuery({
    queryKey: ["gm-snapshot", campaignId],
    queryFn: () => api.gmSnapshot(campaignId!),
    enabled: Boolean(campaignId) && session.isSuccess,
  });

  const toggleCharacterVisibility = useMutation({
    mutationFn: async (characterId: string) => {
      if (!campaignId || !snapshot.data) throw new Error("Кампания ещё не загружена.");
      const states = snapshot.data.scene.characters;
      const state = states.find((item) => item.character_id === characterId);
      const visibleStates = states.filter((item) => item.is_visible);
      const isVisible = !(state?.is_visible ?? false);
      await api.updateSceneCharacter(campaignId, characterId, {
        is_visible: isVisible,
        order: isVisible ? visibleStates.length : state?.order,
        base_revision: state?.revision ?? 1,
      });
      return { characterId, isVisible };
    },
    onSuccess: ({ characterId, isVisible }) => {
      if (isVisible) {
        selectCharacter(characterId);
      } else if (selectedCharacterId === characterId) {
        selectCharacter(null);
      }
      void queryClient.invalidateQueries({ queryKey: ["gm-snapshot", campaignId] });
    },
    onError: (error) =>
      toast.push({
        tone: "error",
        title: "Состав сцены не изменился",
        description: describeError(error),
      }),
  });

  const handleRealtime = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["gm-snapshot", campaignId] });
  }, [campaignId, queryClient]);
  useRealtime(campaignId, snapshot.data?.last_sequence ?? 0, undefined, handleRealtime);

  if (session.error instanceof ApiError && session.error.status === 401) {
    return (
      <main className="center-screen">
        <span className="eyebrow">Защищённая консоль</span>
        <h1>Откройте GM Console через launcher</h1>
        <p>
          Сессия мастера создаётся одноразовой локальной ссылкой. Запустите{" "}
          <code>ai-dnd serve --open</code>.
        </p>
      </main>
    );
  }
  if (session.isPending || campaigns.isPending || snapshot.isPending) {
    return <main className="center-screen">Подготовка кампании…</main>;
  }
  if (session.error || campaigns.error || snapshot.error || !snapshot.data || !campaignId) {
    return (
      <main className="center-screen">
        <ErrorNotice error={session.error ?? campaigns.error ?? snapshot.error} />
      </main>
    );
  }

  const characters = snapshot.data.characters as CharacterGM[];
  const activeEvent = snapshot.data.active_event;
  const lastTurn = activeEvent?.turns.at(-1);
  const onSceneIds = snapshot.data.scene.characters
    .filter((state) => state.is_visible)
    .sort((left, right) => left.order - right.order)
    .map((state) => state.character_id);
  const selectedCharacter = characters.find((character) => character.id === selectedCharacterId);
  const refreshSnapshot = () => {
    void queryClient.invalidateQueries({ queryKey: ["gm-snapshot", campaignId] });
  };

  /* Шаг цикла выводится из снапшота, а не хранится отдельно: любое обновление
     состояния кампании сразу отражается на полосе. */
  const stage: TurnStage =
    appliedForTurnId && appliedForTurnId === lastTurn?.id
      ? 4
      : proposal
        ? 3
        : lastTurn?.character_id
          ? 3
          : lastTurn
            ? 2
            : 1;

  return (
    <main className="gm-shell">
      <PageHotkeys
        characterIds={onSceneIds}
        onSelect={selectCharacter}
        onToggleStrip={toggleStrip}
        onShortcuts={() => setShortcutsOpen(true)}
        onEscape={observerDrawerOpen ? () => setObserverDrawerOpen(false) : undefined}
      />
      <CommandBar
        key={campaignId}
        campaignId={campaignId}
        campaigns={campaigns.data ?? []}
        campaignSelectionPending={activateCampaign.isPending}
        onSelectCampaign={(nextCampaignId) => activateCampaign.mutate(nextCampaignId)}
        snapshot={snapshot.data}
        characters={characters}
        spectatorCode={session.data?.spectator_code}
        onToggleCharacter={(characterId) => toggleCharacterVisibility.mutate(characterId)}
        characterSelectionPending={toggleCharacterVisibility.isPending}
        onChanged={refreshSnapshot}
        openPopover={openPopover}
        onOpenPopover={setOpenPopover}
        observerOpen={observerDrawerOpen}
        onToggleObserver={() => setObserverDrawerOpen((value) => !value)}
      />

      <FlowStripBinding stage={stage} idle={!activeEvent} />

      <section
        className="gm-work"
        style={
          {
            "--col-left": `${leftWidth}px`,
            "--col-right": `${rightWidth}px`,
          } as CSSProperties
        }
      >
        <section className="slab gm-column" aria-label="Лог события и запись речи">
          <EventLogColumn
            campaignId={campaignId}
            snapshot={snapshot.data}
            characters={characters}
            onChanged={refreshSnapshot}
          />
        </section>

        <ColumnResizer
          side="left"
          width={leftWidth}
          onResize={(width) => setColumnWidth("left", width)}
        />

        <section className="slab gm-column" aria-label="Ответ модели-игрока">
          {activeEvent?.status === "active" ? (
            <TurnComposer
              key={`${activeEvent.id}:${selectedCharacter?.id ?? "none"}`}
              campaignId={campaignId}
              eventId={activeEvent.id}
              character={selectedCharacter}
              onTurnPublished={(turnId) => {
                setProposal(null);
                setObserverTurnId(turnId);
              }}
              onChanged={refreshSnapshot}
              onPickCharacter={() => setOpenPopover("characters")}
            />
          ) : (
            <>
              <div className="panel-head">
                <h2 className="panel-head__title panel-head__title--model">
                  Ответ модели-игрока
                </h2>
              </div>
              <ActorHeader
                character={selectedCharacter}
                onPick={() => setOpenPopover("characters")}
              />
              <div className="composer">
                <div className="composer__idle">
                  <h3>
                    {activeEvent?.status === "finalizing"
                      ? "Архивариус завершает событие"
                      : "Событие не запущено"}
                  </h3>
                  <p>
                    {activeEvent?.status === "finalizing"
                      ? "Пока итог не сохранён, новые ходы не принимаются."
                      : "Соберите персонажей на сцене и запустите событие в правой части верхней панели."}
                  </p>
                </div>
              </div>
            </>
          )}
        </section>

        <ColumnResizer
          side="right"
          width={rightWidth}
          onResize={(width) => setColumnWidth("right", width)}
        />

        <aside
          className={`slab gm-column gm-column--observer${
            observerDrawerOpen ? " is-open" : ""
          }`}
          aria-label="Наблюдатель"
        >
          <ObserverPanel
            key={activeEvent?.id ?? "no-event"}
            campaignId={campaignId}
            snapshot={snapshot.data}
            characters={characters}
            requestedTurnId={observerTurnId}
            proposal={proposal}
            setProposal={setProposal}
            onApplied={setAppliedForTurnId}
            onChanged={refreshSnapshot}
            onCloseDrawer={() => setObserverDrawerOpen(false)}
          />
        </aside>
      </section>

      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}

      <CharacterStrip
        campaignId={campaignId}
        snapshot={snapshot.data}
        characters={characters}
        onAddCharacter={() => setOpenPopover("characters")}
        onRemoveCharacter={(characterId) => toggleCharacterVisibility.mutate(characterId)}
        onChanged={refreshSnapshot}
      />
    </main>
  );
}

/**
 * Клавиши уровня страницы вынесены в отдельный компонент: иначе выбор
 * персонажа цифрой перерисовывал бы консоль на каждое нажатие любой клавиши.
 */
function PageHotkeys({
  characterIds,
  onSelect,
  onToggleStrip,
  onShortcuts,
  onEscape,
}: {
  characterIds: string[];
  onSelect: (characterId: string) => void;
  onToggleStrip: () => void;
  onShortcuts: () => void;
  onEscape?: () => void;
}) {
  useHotkeys([
    ...characterIds.slice(0, 9).map((characterId, index) => ({
      code: `Digit${index + 1}`,
      handler: () => onSelect(characterId),
    })),
    { code: "Backslash", alt: true, handler: onToggleStrip },
    { code: "Slash", shift: true, handler: onShortcuts },
    {
      code: "Escape",
      enabled: Boolean(onEscape),
      allowInField: true,
      handler: () => onEscape?.(),
    },
  ]);
  return null;
}

/** Полоса подписана на стор занятости, чтобы тик секунд не трогал всю консоль. */
function FlowStripBinding({ stage, idle }: { stage: TurnStage; idle: boolean }) {
  const busy = useFlowStore((state) => state.busy);
  return <TurnFlowStrip stage={stage} busy={busy ?? undefined} idle={idle} />;
}


function EventLogColumn({
  campaignId,
  snapshot,
  characters,
  onChanged,
}: {
  campaignId: string;
  snapshot: GameStateSnapshot;
  characters: CharacterGM[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const activeEvent = snapshot.active_event;
  const compress = useJobRunner({
    start: () => {
      if (!activeEvent) throw new Error("Нет активного события.");
      return api.generateContextCompression(campaignId, activeEvent.id, activeEvent.revision);
    },
    fetchJob: (jobId) => api.getJob(campaignId, jobId),
    parse: (job) => job.output_data,
    describeFailure: (job) => `Не удалось сжать контекст: ${job.error_code ?? job.status}`,
    timeoutMessage: "Архивариус не ответил вовремя.",
    onSuccess: (output) => {
      toast.push({
        tone: "archivist",
        title: "Архивариус",
        description:
          output?.status === "skipped"
            ? String(output.message)
            : "Старая часть контекста свёрнута в сводку.",
      });
      onChanged();
    },
  });

  useEffect(() => {
    if (!compress.error) return;
    toast.push({
      tone: "error",
      title: "Контекст не сжат",
      description: describeError(compress.error),
    });
  }, [compress.error, toast]);

  return (
    <>
      <EventLog
        snapshot={snapshot}
        characters={characters}
        compressing={compress.isPending}
        onCompress={() => compress.run()}
      />
      <VoiceDock
        campaignId={campaignId}
        eventId={activeEvent?.status === "active" ? activeEvent.id : undefined}
        onChanged={onChanged}
      />
    </>
  );
}
