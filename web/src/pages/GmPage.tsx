import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { api, ApiError } from "../api/client";
import type {
  CharacterGM,
  CharacterPublic,
  GameStateSnapshot,
  ObserverOperation,
  ObserverProposal,
} from "../api/types";
import { ErrorNotice } from "../components/ErrorNotice";
import { GmCharacterCard } from "../components/GmCharacterCard";
import { GmTopControls } from "../components/GmTopControls";
import { VoiceWorkspace } from "../components/VoiceWorkspace";
import { useRealtime } from "../hooks/useRealtime";
import { useUiStore } from "../store/ui";

const turnSchema = z.object({
  action: z.string().trim().min(1).max(30_000),
  thought: z.string().max(30_000).optional(),
});
type TurnForm = z.infer<typeof turnSchema>;

export default function GmPage() {
  const queryClient = useQueryClient();
  const [proposal, setProposal] = useState<ObserverProposal | null>(null);
  const [observerTurnId, setObserverTurnId] = useState<string>();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>();
  const selectedCharacterId = useUiStore((state) => state.selectedCharacterId);
  const selectCharacter = useUiStore((state) => state.selectCharacter);
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
  });
  const snapshot = useQuery({
    queryKey: ["gm-snapshot", campaignId],
    queryFn: () => api.gmSnapshot(campaignId!),
    enabled: Boolean(campaignId) && session.isSuccess,
  });
  const toggleCharacterVisibility = useMutation({
    mutationFn: async (characterId: string) => {
      if (!campaignId || !snapshot.data) {
        throw new Error("Кампания ещё не загружена.");
      }
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
  });

  const handleRealtime = useCallback(
    () => {
      void queryClient.invalidateQueries({ queryKey: ["gm-snapshot", campaignId] });
    },
    [campaignId, queryClient],
  );
  useRealtime(
    campaignId,
    snapshot.data?.last_sequence ?? 0,
    undefined,
    handleRealtime,
  );

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
  const displayedCharacterIds = snapshot.data.scene.characters
    .filter((state) => state.is_visible)
    .sort((left, right) => left.order - right.order)
    .map((state) => state.character_id);
  const selectedCharacter = characters.find(
    (character) => character.id === selectedCharacterId,
  );
  const refreshSnapshot = () => {
    void queryClient.invalidateQueries({ queryKey: ["gm-snapshot", campaignId] });
  };

  return (
    <main className="gm-shell">
      <header className="topbar">
        <GmTopControls
          key={campaignId}
          campaignId={campaignId}
          campaigns={campaigns.data ?? []}
          campaignSelectionPending={activateCampaign.isPending}
          campaignSelectionError={activateCampaign.error}
          onSelectCampaign={(nextCampaignId) =>
            activateCampaign.mutate(nextCampaignId)
          }
          snapshot={snapshot.data}
          characters={characters}
          spectatorCode={session.data?.spectator_code}
          onToggleCharacter={(characterId) =>
            toggleCharacterVisibility.mutate(characterId)
          }
          characterSelectionPending={toggleCharacterVisibility.isPending}
          characterSelectionError={toggleCharacterVisibility.error}
          onChanged={refreshSnapshot}
        />
      </header>

      <section className="gm-grid">
        <aside className="panel panel--voice-log" aria-label="Голос и лог события">
          <VoiceWorkspace
            campaignId={campaignId}
            eventId={
              snapshot.data.active_event?.status === "active"
                ? snapshot.data.active_event.id
                : undefined
            }
            onChanged={refreshSnapshot}
          />
          <EventTimeline
            campaignId={campaignId}
            snapshot={snapshot.data}
            onChanged={refreshSnapshot}
          />
        </aside>

        <section className="panel panel--stage">
          {snapshot.data.active_event?.status === "active" ? (
            <TurnComposer
              key={`${snapshot.data.active_event.id}:${selectedCharacter?.id ?? "none"}`}
              campaignId={campaignId}
              eventId={snapshot.data.active_event.id}
              character={selectedCharacter}
              onTurnPublished={(turnId) => {
                setProposal(null);
                setObserverTurnId(turnId);
              }}
              onChanged={refreshSnapshot}
            />
          ) : (
            <div className="model-response-empty">
              <span className="eyebrow">Ответ модели-игрока</span>
              <h2>
                {snapshot.data.active_event?.status === "finalizing"
                  ? "Событие завершается"
                  : "Запустите игровое событие"}
              </h2>
              <p>
                Выбор персонажей и управление игровым событием находятся на верхней
                панели.
              </p>
            </div>
          )}
        </section>

        <aside className="panel panel--observer">
          <ObserverPanel
            key={snapshot.data.active_event?.id ?? "no-event"}
            campaignId={campaignId}
            snapshot={snapshot.data}
            requestedTurnId={observerTurnId}
            proposal={proposal}
            setProposal={setProposal}
            onChanged={refreshSnapshot}
          />
        </aside>

        <section className="panel panel--character-strip">
          <div className="panel__header">
            <div>
              <span className="eyebrow">Карточки персонажей</span>
              <h2>Выбранные персонажи</h2>
            </div>
            <span>{displayedCharacterIds.length} показано</span>
          </div>
          <div className="gm-character-strip">
            {displayedCharacterIds.length === 0 && (
              <div className="gm-character-strip__empty">
                Выберите персонажей в выпадающем списке сверху. Здесь появятся их карточки.
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
        </section>
      </section>
    </main>
  );
}

function EventTimeline({
  campaignId,
  snapshot,
  onChanged,
}: {
  campaignId: string;
  snapshot: GameStateSnapshot;
  onChanged: () => void;
}) {
  const [compressionMessage, setCompressionMessage] = useState<string>();
  const activeEvent = snapshot.active_event;
  const throughSequence = activeEvent?.context_summary_through_sequence ?? 0;
  const visibleTurns =
    activeEvent?.turns.filter((turn) => turn.sequence > throughSequence) ?? [];
  const compress = useMutation({
    mutationFn: async () => {
      if (!activeEvent) throw new Error("Нет активного события.");
      const job = await api.generateContextCompression(
        campaignId,
        activeEvent.id,
        activeEvent.revision,
      );
      for (let attempt = 0; attempt < 180; attempt += 1) {
        const current = await api.getJob(campaignId, job.id);
        if (current.status === "succeeded") {
          return current.output_data;
        }
        if (["failed", "degraded", "cancelled"].includes(current.status)) {
          throw new Error(
            `Не удалось сжать контекст: ${current.error_code ?? current.status}`,
          );
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      throw new Error("Архивариус не ответил вовремя.");
    },
    onSuccess: (output) => {
      setCompressionMessage(
        output?.status === "skipped"
          ? String(output.message)
          : "Старая часть контекста сжата.",
      );
      onChanged();
    },
  });
  return (
    <section className="event-log-workspace">
      <div className="panel__header">
        <div>
          <span className="eyebrow">Event log</span>
          <h2>{snapshot.active_event?.title ?? "Нет активного события"}</h2>
        </div>
        <div className="event-log-workspace__actions">
          <span>
            {(activeEvent?.context_summary ? 1 : 0) + visibleTurns.length}
          </span>
          {activeEvent?.status === "active" && (
            <button
              className="button button--quiet"
              type="button"
              disabled={compress.isPending}
              onClick={() => compress.mutate()}
            >
              {compress.isPending ? "Сжимаем…" : "Сжать контекст"}
            </button>
          )}
        </div>
      </div>
      <div className="timeline" aria-live="polite">
        {activeEvent?.context_summary && (
          <article className="turn turn--summary">
            <span className="turn__sequence">1–{throughSequence}</span>
            <div>
              <strong>Game Master · сжатый контекст</strong>
              <p>{activeEvent.context_summary}</p>
            </div>
          </article>
        )}
        {visibleTurns.map((turn) => (
          <article className="turn" key={turn.id}>
            <span className="turn__sequence">{String(turn.sequence).padStart(2, "0")}</span>
            <div>
              <strong>{turn.actor_name}</strong>
              {turn.thought && <p className="turn__thought">{turn.thought}</p>}
              <p>{turn.action}</p>
            </div>
            {turn.dice_roll && <span className="die">d20 · {turn.dice_roll}</span>}
          </article>
        ))}
        {!snapshot.active_event && (
          <div className="event-log-workspace__empty">Лог появится после запуска события.</div>
        )}
      </div>
      {compressionMessage && <p className="compression-message">{compressionMessage}</p>}
      {compress.error && <ErrorNotice error={compress.error} />}
    </section>
  );
}

function TurnComposer({
  campaignId,
  eventId,
  character,
  onTurnPublished,
  onChanged,
}: {
  campaignId: string;
  eventId: string;
  character: CharacterPublic | undefined;
  onTurnPublished: (turnId: string) => void;
  onChanged: () => void;
}) {
  const [draftReady, setDraftReady] = useState(false);
  const form = useForm<TurnForm>({
    resolver: zodResolver(turnSchema),
    defaultValues: { action: "", thought: "" },
  });
  const createTurn = useMutation({
    mutationFn: ({
      value,
      rollDice,
    }: {
      value: TurnForm;
      rollDice: boolean;
    }) =>
      api.createTurn(campaignId, eventId, {
        character_id: character?.id ?? null,
        actor_name: character?.name ?? "Game Master",
        actor_role: character?.role ?? "gm",
        thought: value.thought || undefined,
        action: value.action,
        roll_dice: rollDice,
      }),
    onSuccess: (turn) => {
      form.reset();
      setDraftReady(false);
      onTurnPublished(turn.id);
      void onChanged();
    },
  });
  const generateTurn = useMutation({
    mutationFn: async () => {
      if (!character) throw new Error("Сначала выберите персонажа.");
      const job = await api.generatePlayerTurn(campaignId, eventId, character.id);
      for (let attempt = 0; attempt < 180; attempt += 1) {
        const current = await api.getJob(campaignId, job.id);
        if (current.status === "succeeded") {
          const output = current.output_data;
          if (
            !output ||
            typeof output.thought !== "string" ||
            typeof output.action !== "string"
          ) {
            throw new Error("Модель вернула неполный черновик.");
          }
          return { thought: output.thought, action: output.action };
        }
        if (["failed", "degraded", "cancelled"].includes(current.status)) {
          throw new Error(
            `Не удалось создать черновик: ${current.error_code ?? current.status}`,
          );
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      throw new Error("Модель не ответила вовремя.");
    },
    onSuccess: (draft) => {
      form.setValue("thought", draft.thought, { shouldDirty: true });
      form.setValue("action", draft.action, { shouldDirty: true });
      setDraftReady(true);
    },
  });
  const publish = (rollDice: boolean) => {
    void form.handleSubmit((value) => createTurn.mutate({ value, rollDice }))();
  };
  return (
    <form
      className="composer"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="composer__heading">
        <div>
          <span className="eyebrow">Игровое событие</span>
          <h2>Ответ модели-игрока</h2>
        </div>
      </div>
      <div className="composer__actor">
        <span>Активный персонаж</span>
        <strong>{character?.name ?? "Не выбран"}</strong>
      </div>
      <div className="composer__draft-actions">
        <button
          className="button button--secondary"
          type="button"
          disabled={!character || generateTurn.isPending}
          onClick={() => generateTurn.mutate()}
        >
          {generateTurn.isPending ? "Модель отвечает…" : "Сгенерировать ответ"}
        </button>
        {draftReady && (
          <span>Проверьте и при необходимости отредактируйте мысль и действие.</span>
        )}
      </div>
      <label htmlFor="thought">Мысль модели</label>
      <textarea id="thought" rows={3} {...form.register("thought")} />
      <label htmlFor="action">Публичное действие</label>
      <textarea id="action" rows={7} {...form.register("action")} />
      <div className="composer__actions">
        <button
          className="button button--quiet"
          type="button"
          disabled={!character || createTurn.isPending}
          onClick={() => publish(false)}
        >
          Отправить
        </button>
        <button
          className="button"
          type="button"
          disabled={!character || createTurn.isPending}
          onClick={() => publish(true)}
        >
          Отправить с dice roll
        </button>
      </div>
      {form.formState.errors.action && (
        <span className="field-error">{form.formState.errors.action.message}</span>
      )}
      {(createTurn.error || generateTurn.error) && (
        <ErrorNotice error={createTurn.error ?? generateTurn.error} />
      )}
    </form>
  );
}

function ObserverPanel({
  campaignId,
  snapshot,
  requestedTurnId,
  proposal,
  setProposal,
  onChanged,
}: {
  campaignId: string;
  snapshot: GameStateSnapshot;
  requestedTurnId: string | undefined;
  proposal: ObserverProposal | null;
  setProposal: (proposal: ObserverProposal | null) => void;
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
    if (!Array.isArray(parsed)) {
      throw new Error("Operations должны быть JSON-массивом.");
    }
    return parsed as ObserverOperation[];
  };
  const useProposal = (nextProposal: ObserverProposal) => {
    setProposal(nextProposal);
    setBrief(nextProposal.gm_brief);
    setOperationsText(JSON.stringify(nextProposal.operations, null, 2));
  };
  const generate = useMutation({
    mutationFn: async (turnId: string) => {
      const job = await api.generateObserver(
        campaignId,
        snapshot.active_event!.id,
        turnId,
      );
      for (let attempt = 0; attempt < 180; attempt += 1) {
        const current = await api.getJob(campaignId, job.id);
        if (current.status === "succeeded") {
          const proposalId = current.output_data?.proposal_id;
          if (typeof proposalId !== "string") {
            throw new Error("Наблюдатель не вернул предложение.");
          }
          return api.getProposal(campaignId, proposalId);
        }
        if (["failed", "degraded", "cancelled"].includes(current.status)) {
          throw new Error(
            `Наблюдатель недоступен: ${current.error_code ?? current.status}`,
          );
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      throw new Error("Наблюдатель не ответил вовремя.");
    },
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
      api.applyProposal(
        campaignId,
        proposal!.id,
        brief.trim(),
        parseOperations(),
      ),
    onSuccess: () => {
      setProposal(null);
      setBrief("");
      setOperationsText("[]");
      void onChanged();
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
      generate.mutate(requestedTurnId);
    }
  }, [
    eventAcceptsChanges,
    generate,
    proposal?.turn_id,
    requestedTurnExists,
    requestedTurnId,
  ]);
  const reset = () => {
    setProposal(null);
    setBrief("");
    setOperationsText("[]");
  };

  return (
    <>
      <div className="panel__header">
        <div>
          <span className="eyebrow">Observer</span>
          <h2>Механика хода</h2>
        </div>
        <span className="revision">rev {snapshot.campaign.revision}</span>
      </div>
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
          <textarea id="gm-brief" rows={7} value={brief} onChange={(e) => setBrief(e.target.value)} />
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
                  onClick={() => generate.mutate(lastTurn.id)}
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
                onClick={() => generate.mutate(lastTurn.id)}
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
            <ErrorNotice
              error={generate.error ?? createManual.error ?? apply.error}
            />
          )}
        </div>
      )}
    </>
  );
}
