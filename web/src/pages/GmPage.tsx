import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { api, ApiError } from "../api/client";
import type {
  CharacterPublic,
  GameStateSnapshot,
  ObserverProposal,
} from "../api/types";
import { CharacterCard } from "../components/CharacterCard";
import { ConnectionBadge } from "../components/ConnectionBadge";
import { ErrorNotice } from "../components/ErrorNotice";
import { useRealtime } from "../hooks/useRealtime";
import { useUiStore } from "../store/ui";

const eventSchema = z.object({ title: z.string().trim().min(2).max(200) });
const turnSchema = z.object({
  action: z.string().trim().min(1).max(30_000),
  thought: z.string().max(30_000).optional(),
  diceRoll: z.number().int().min(1).max(20).optional(),
});
type EventForm = z.infer<typeof eventSchema>;
type TurnForm = z.infer<typeof turnSchema>;

export default function GmPage() {
  const queryClient = useQueryClient();
  const [proposal, setProposal] = useState<ObserverProposal | null>(null);
  const selectedCharacterId = useUiStore((state) => state.selectedCharacterId);
  const selectCharacter = useUiStore((state) => state.selectCharacter);
  const session = useQuery({ queryKey: ["gm-session"], queryFn: api.gmSession, retry: false });
  const campaigns = useQuery({ queryKey: ["campaigns"], queryFn: api.campaigns });
  const campaignId = campaigns.data?.[0]?.id;
  const snapshot = useQuery({
    queryKey: ["gm-snapshot", campaignId],
    queryFn: () => api.gmSnapshot(campaignId!),
    enabled: Boolean(campaignId) && session.isSuccess,
  });

  useEffect(() => {
    if (!selectedCharacterId && snapshot.data?.characters[0]) {
      selectCharacter(snapshot.data.characters[0].id);
    }
  }, [selectCharacter, selectedCharacterId, snapshot.data?.characters]);

  const handleRealtime = useCallback(
    () => {
      void queryClient.invalidateQueries({ queryKey: ["gm-snapshot", campaignId] });
    },
    [campaignId, queryClient],
  );
  const connection = useRealtime(
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

  const selectedCharacter =
    snapshot.data.characters.find((character) => character.id === selectedCharacterId) ??
    snapshot.data.characters[0];
  const refreshSnapshot = () => {
    void queryClient.invalidateQueries({ queryKey: ["gm-snapshot", campaignId] });
  };

  return (
    <main className="gm-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">GM Console</span>
          <h1>{snapshot.data.campaign.name}</h1>
        </div>
        <div className="topbar__meta">
          <ConnectionBadge state={connection} />
          <span className="join-code">
            Код зрителя <strong>{session.data?.spectator_code}</strong>
          </span>
        </div>
      </header>

      <section className="gm-grid">
        <aside className="panel panel--roster" aria-label="Персонажи">
          <div className="panel__header">
            <span className="eyebrow">Участники</span>
            <strong>{snapshot.data.characters.length}</strong>
          </div>
          <div className="roster">
            {snapshot.data.characters.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                compact
                selected={character.id === selectedCharacter?.id}
                onSelect={(item) => selectCharacter(item.id)}
              />
            ))}
          </div>
        </aside>

        <section className="panel panel--stage">
          <EventControls
            campaignId={campaignId}
            snapshot={snapshot.data}
            onChanged={refreshSnapshot}
          />
          {snapshot.data.active_event ? (
            <TurnComposer
              campaignId={campaignId}
              eventId={snapshot.data.active_event.id}
              character={selectedCharacter}
              onChanged={refreshSnapshot}
            />
          ) : (
            <div className="empty-state">
              <span>01</span>
              <h2>Начните игровое событие</h2>
              <p>После запуска здесь появятся управление ходом и ответы моделей.</p>
            </div>
          )}
        </section>

        <aside className="panel panel--observer">
          <ObserverPanel
            key={selectedCharacter?.id}
            campaignId={campaignId}
            snapshot={snapshot.data}
            selectedCharacter={selectedCharacter}
            proposal={proposal}
            setProposal={setProposal}
            onChanged={refreshSnapshot}
          />
        </aside>

        <section className="panel panel--timeline">
          <div className="panel__header">
            <div>
              <span className="eyebrow">Event log</span>
              <h2>{snapshot.data.active_event?.title ?? "Нет активного события"}</h2>
            </div>
            <span>{snapshot.data.active_event?.turns.length ?? 0} ходов</span>
          </div>
          <div className="timeline" aria-live="polite">
            {snapshot.data.active_event?.turns.map((turn) => (
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
          </div>
        </section>
      </section>
    </main>
  );
}

function EventControls({
  campaignId,
  snapshot,
  onChanged,
}: {
  campaignId: string;
  snapshot: GameStateSnapshot;
  onChanged: () => void;
}) {
  const form = useForm<EventForm>({
    resolver: zodResolver(eventSchema),
    defaultValues: { title: "Новое игровое событие" },
  });
  const start = useMutation({
    mutationFn: ({ title }: EventForm) => api.startEvent(campaignId, title),
    onSuccess: onChanged,
  });
  const archive = useMutation({
    mutationFn: () => api.archiveEvent(campaignId, snapshot.active_event!.id),
    onSuccess: onChanged,
  });

  return (
    <div className="stage-header">
      <div>
        <span className="eyebrow">Игровое событие</span>
        <h2>{snapshot.active_event?.title ?? "Ожидание"}</h2>
      </div>
      {snapshot.active_event ? (
        <button className="button button--quiet" type="button" onClick={() => archive.mutate()}>
          Завершить событие
        </button>
      ) : (
        <form
          className="inline-form"
          onSubmit={(event) => {
            void form.handleSubmit((value) => start.mutate(value))(event);
          }}
        >
          <label className="sr-only" htmlFor="event-title">
            Название события
          </label>
          <input id="event-title" {...form.register("title")} />
          <button className="button" type="submit" disabled={start.isPending}>
            Запустить
          </button>
        </form>
      )}
      {(start.error || archive.error) && <ErrorNotice error={start.error ?? archive.error} />}
    </div>
  );
}

function TurnComposer({
  campaignId,
  eventId,
  character,
  onChanged,
}: {
  campaignId: string;
  eventId: string;
  character: CharacterPublic | undefined;
  onChanged: () => void;
}) {
  const form = useForm<TurnForm>({
    resolver: zodResolver(turnSchema),
    defaultValues: { action: "", thought: "" },
  });
  const createTurn = useMutation({
    mutationFn: (value: TurnForm) =>
      api.createTurn(campaignId, eventId, {
        character_id: character?.id ?? null,
        actor_name: character?.name ?? "Game Master",
        actor_role: character?.role ?? "gm",
        thought: value.thought || undefined,
        action: value.action,
        dice_roll: value.diceRoll,
      }),
    onSuccess: () => {
      form.reset();
      void onChanged();
    },
  });
  return (
    <form
      className="composer"
      onSubmit={(event) => {
        void form.handleSubmit((value) => createTurn.mutate(value))(event);
      }}
    >
      <div className="composer__actor">
        <span>Активный персонаж</span>
        <strong>{character?.name ?? "Game Master"}</strong>
      </div>
      <label htmlFor="thought">Мысль модели</label>
      <textarea id="thought" rows={3} {...form.register("thought")} />
      <label htmlFor="action">Публичное действие</label>
      <textarea id="action" rows={7} {...form.register("action")} />
      <div className="composer__actions">
        <label className="dice-input">
          d20
          <input
            type="number"
            min={1}
            max={20}
            {...form.register("diceRoll", {
              setValueAs: (value: string) => (value === "" ? undefined : Number(value)),
            })}
          />
        </label>
        <button className="button" type="submit" disabled={createTurn.isPending}>
          Зафиксировать ход
        </button>
      </div>
      {form.formState.errors.action && (
        <span className="field-error">{form.formState.errors.action.message}</span>
      )}
      {createTurn.error && <ErrorNotice error={createTurn.error} />}
    </form>
  );
}

function ObserverPanel({
  campaignId,
  snapshot,
  selectedCharacter,
  proposal,
  setProposal,
  onChanged,
}: {
  campaignId: string;
  snapshot: GameStateSnapshot;
  selectedCharacter: CharacterPublic | undefined;
  proposal: ObserverProposal | null;
  setProposal: (proposal: ObserverProposal | null) => void;
  onChanged: () => void;
}) {
  const [brief, setBrief] = useState("Механическое последствие подтверждено мастером.");
  const [hp, setHp] = useState(selectedCharacter?.hp_current ?? 0);
  const lastTurn = snapshot.active_event?.turns.at(-1);

  const operation = useMemo(
    () =>
      selectedCharacter
        ? [
            {
              op: "set_resource" as const,
              character_id: selectedCharacter.id,
              resource: "hp" as const,
              current: hp,
            },
          ]
        : [],
    [hp, selectedCharacter],
  );
  const create = useMutation({
    mutationFn: () =>
      api.createProposal(campaignId, snapshot.active_event!.id, {
        turn_id: lastTurn!.id,
        gm_brief: brief,
        base_revision: snapshot.campaign.revision,
        operations: operation,
      }),
    onSuccess: setProposal,
  });
  const apply = useMutation({
    mutationFn: () => api.applyProposal(campaignId, proposal!.id, operation),
    onSuccess: () => {
      setProposal(null);
      void onChanged();
    },
  });

  return (
    <>
      <div className="panel__header">
        <div>
          <span className="eyebrow">Observer</span>
          <h2>Механика хода</h2>
        </div>
        <span className="revision">rev {snapshot.campaign.revision}</span>
      </div>
      {!lastTurn || !selectedCharacter ? (
        <div className="empty-state empty-state--small">
          <p>Сначала выберите персонажа и зафиксируйте ход.</p>
        </div>
      ) : (
        <div className="observer-form">
          <label htmlFor="gm-brief">GM Brief</label>
          <textarea id="gm-brief" rows={7} value={brief} onChange={(e) => setBrief(e.target.value)} />
          <label htmlFor="observer-hp">Новое HP · {selectedCharacter.name}</label>
          <input
            id="observer-hp"
            type="number"
            min={0}
            max={selectedCharacter.hp_max}
            value={hp}
            onChange={(event) => setHp(Number(event.target.value))}
          />
          {proposal ? (
            <div className="proposal-preview">
              <span className="eyebrow">Ожидает подтверждения</span>
              <p>{proposal.gm_brief}</p>
              <button className="button" type="button" onClick={() => apply.mutate()}>
                Применить изменения
              </button>
            </div>
          ) : (
            <button className="button button--secondary" type="button" onClick={() => create.mutate()}>
              Подготовить предложение
            </button>
          )}
          {(create.error || apply.error) && <ErrorNotice error={create.error ?? apply.error} />}
        </div>
      )}
    </>
  );
}
