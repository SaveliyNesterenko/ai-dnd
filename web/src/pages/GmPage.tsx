import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError } from "../api/client";
import type {
  CharacterGM,
  GameStateSnapshot,
  ObserverOperation,
  ObserverProposal,
} from "../api/types";
import { ErrorNotice } from "../components/ErrorNotice";
import { GmCharacterCard } from "../components/GmCharacterCard";
import { ActorHeader } from "../components/gm/ActorHeader";
import { ColumnResizer } from "../components/gm/ColumnResizer";
import { CommandBar, type OpenPopover } from "../components/gm/CommandBar";
import { EventLog } from "../components/gm/EventLog";
import { TurnComposer } from "../components/gm/TurnComposer";
import { TurnFlowStrip, type TurnStage } from "../components/gm/TurnFlowStrip";
import { VoiceDock } from "../components/gm/VoiceDock";
import { ChevronDown, ChevronUp } from "../components/gm/icons";
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

  const selectedCharacterId = useUiStore((state) => state.selectedCharacterId);
  const selectCharacter = useUiStore((state) => state.selectCharacter);
  const leftWidth = useUiStore((state) => state.leftWidth);
  const rightWidth = useUiStore((state) => state.rightWidth);
  const stripCollapsed = useUiStore((state) => state.stripCollapsed);
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
  const displayedCharacterIds = snapshot.data.scene.characters
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
      />

      <FlowStripBinding stage={stage} idle={!activeEvent} />

      <section
        className="gm-work"
        style={{
          gridTemplateColumns: `${leftWidth}px auto minmax(360px, 1fr) auto ${rightWidth}px`,
        }}
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

        <aside className="slab gm-column" aria-label="Наблюдатель">
          <ObserverPanel
            key={activeEvent?.id ?? "no-event"}
            campaignId={campaignId}
            snapshot={snapshot.data}
            requestedTurnId={observerTurnId}
            proposal={proposal}
            setProposal={setProposal}
            onApplied={setAppliedForTurnId}
            onChanged={refreshSnapshot}
          />
        </aside>
      </section>

      <section
        className={`slab character-strip-panel${stripCollapsed ? " is-collapsed" : ""}`}
        aria-label="Карточки персонажей"
      >
        <div className="strip-head">
          <h2 className="strip-head__title">Персонажи</h2>
          <span className="count-pill">{displayedCharacterIds.length}</span>
          <button
            type="button"
            className="mini-button strip-head__add"
            onClick={() => setOpenPopover("characters")}
          >
            + Добавить
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={stripCollapsed ? "Развернуть ленту персонажей" : "Свернуть ленту персонажей"}
            aria-expanded={!stripCollapsed}
            onClick={toggleStrip}
          >
            {stripCollapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>

        {stripCollapsed ? (
          <div className="strip-rail">
            {displayedCharacterIds.length === 0 && (
              <span className="strip-rail__empty">Никого на сцене</span>
            )}
            {displayedCharacterIds.map((characterId) => {
              const character = characters.find((item) => item.id === characterId);
              if (!character) return null;
              return (
                <button
                  key={character.id}
                  type="button"
                  className={`strip-rail__chip${
                    character.id === selectedCharacterId ? " is-selected" : ""
                  }`}
                  onClick={() => selectCharacter(character.id)}
                >
                  {character.name}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="gm-character-strip">
            {displayedCharacterIds.length === 0 && (
              <div className="gm-character-strip__empty">
                Никого на сцене. Добавьте персонажей — здесь появятся их карточки.
              </div>
            )}
            {displayedCharacterIds.map((characterId) => {
              const character = characters.find((item) => item.id === characterId);
              if (!character) return null;
              return (
                <GmCharacterCard
                  key={character.id}
                  campaignId={campaignId}
                  character={character}
                  sceneState={snapshot.data.scene.characters.find(
                    (state) => state.character_id === character.id,
                  )}
                  selected={character.id === selectedCharacterId}
                  onSelect={() => selectCharacter(character.id)}
                  onRemove={() => toggleCharacterVisibility.mutate(character.id)}
                  onChanged={refreshSnapshot}
                />
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

/** Полоса подписана на стор занятости, чтобы тик секунд не трогал всю консоль. */
function FlowStripBinding({ stage, idle }: { stage: TurnStage; idle: boolean }) {
  const busy = useFlowStore((state) => state.busy);
  return <TurnFlowStrip stage={stage} busy={busy ?? undefined} idle={idle} />;
}

function ObserverPanel({
  campaignId,
  snapshot,
  requestedTurnId,
  proposal,
  setProposal,
  onApplied,
  onChanged,
}: {
  campaignId: string;
  snapshot: GameStateSnapshot;
  requestedTurnId: string | undefined;
  proposal: ObserverProposal | null;
  setProposal: (proposal: ObserverProposal | null) => void;
  onApplied: (turnId: string) => void;
  onChanged: () => void;
}) {
  const [brief, setBrief] = useState("");
  const [operationsText, setOperationsText] = useState("[]");
  const lastTurn = snapshot.active_event?.turns.at(-1);
  const eventAcceptsChanges = snapshot.active_event?.status === "active";
  const requestedTurnExists = snapshot.active_event?.turns.some(
    (turn) => turn.id === requestedTurnId,
  );
  const parseOperations = () => {
    const parsed: unknown = JSON.parse(operationsText);
    if (!Array.isArray(parsed)) throw new Error("Operations должны быть JSON-массивом.");
    return parsed as ObserverOperation[];
  };
  const useProposal = (nextProposal: ObserverProposal) => {
    setProposal(nextProposal);
    setBrief(nextProposal.gm_brief);
    setOperationsText(JSON.stringify(nextProposal.operations, null, 2));
  };
  const generate = useJobRunner({
    start: (turnId: string) =>
      api.generateObserver(campaignId, snapshot.active_event!.id, turnId),
    fetchJob: (jobId) => api.getJob(campaignId, jobId),
    parse: (job) => {
      const proposalId = job.output_data?.proposal_id;
      if (typeof proposalId !== "string") throw new Error("Наблюдатель не вернул предложение.");
      return api.getProposal(campaignId, proposalId);
    },
    describeFailure: (job) => `Наблюдатель недоступен: ${job.error_code ?? job.status}`,
    timeoutMessage: "Наблюдатель не ответил вовремя.",
    onSuccess: useProposal,
  });
  const createManual = useMutation({
    mutationFn: () =>
      api.createProposal(campaignId, snapshot.active_event!.id, {
        turn_id: lastTurn!.id,
        gm_brief: brief.trim() || "Ручное предложение GM.",
        base_revision: snapshot.campaign.revision,
        operations: parseOperations(),
      }),
    onSuccess: useProposal,
  });
  const apply = useMutation({
    mutationFn: () =>
      api.applyProposal(campaignId, proposal!.id, brief.trim(), parseOperations()),
    onSuccess: () => {
      if (proposal) onApplied(proposal.turn_id);
      setProposal(null);
      setBrief("");
      setOperationsText("[]");
      onChanged();
    },
  });
  const automaticTurnRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      requestedTurnId &&
      requestedTurnExists &&
      eventAcceptsChanges &&
      proposal?.turn_id !== requestedTurnId &&
      automaticTurnRef.current !== requestedTurnId &&
      !generate.isPending
    ) {
      automaticTurnRef.current = requestedTurnId;
      generate.run(requestedTurnId);
    }
  }, [eventAcceptsChanges, generate, proposal?.turn_id, requestedTurnExists, requestedTurnId]);
  const reset = () => {
    setProposal(null);
    setBrief("");
    setOperationsText("[]");
  };

  return (
    <>
      <div className="panel-head">
        <h2 className="panel-head__title panel-head__title--observer">Наблюдатель</h2>
        <span className="panel-head__aside mono">rev {snapshot.campaign.revision}</span>
      </div>
      <div className="gm-column__scroll">
        {!eventAcceptsChanges || !lastTurn ? (
          <div className="empty-state empty-state--small">
            <p>
              {snapshot.active_event?.status === "finalizing"
                ? "Изменения механики отключены, пока Архивариус завершает событие."
                : "Сначала зафиксируйте ход."}
            </p>
          </div>
        ) : (
          <div className="observer-form">
            <label htmlFor="gm-brief">GM Brief</label>
            <textarea
              id="gm-brief"
              rows={7}
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
            />
            <label htmlFor="observer-operations">Typed operations · JSON</label>
            <textarea
              id="observer-operations"
              rows={12}
              value={operationsText}
              spellCheck={false}
              onChange={(event) => setOperationsText(event.target.value)}
            />
            {proposal ? (
              <div className="proposal-preview">
                <span className="eyebrow">Ожидает подтверждения</span>
                <div className="observer-buttons">
                  <button
                    className="button"
                    type="button"
                    disabled={apply.isPending || !brief.trim()}
                    onClick={() => apply.mutate()}
                  >
                    Применить изменения
                  </button>
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={generate.isPending}
                    onClick={() => generate.run(lastTurn.id)}
                  >
                    {generate.isPending ? "Повторяем…" : "Повторить"}
                  </button>
                  <button className="button button--quiet" type="button" onClick={reset}>
                    Сбросить
                  </button>
                </div>
              </div>
            ) : (
              <div className="observer-buttons">
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={generate.isPending}
                  onClick={() => generate.run(lastTurn.id)}
                >
                  {generate.isPending ? "Наблюдатель анализирует…" : "Запустить Наблюдателя"}
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={createManual.isPending}
                  onClick={() => createManual.mutate()}
                >
                  Создать вручную
                </button>
              </div>
            )}
            {(generate.error || createManual.error || apply.error) && (
              <ErrorNotice error={generate.error ?? createManual.error ?? apply.error} />
            )}
          </div>
        )}
      </div>
    </>
  );
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
