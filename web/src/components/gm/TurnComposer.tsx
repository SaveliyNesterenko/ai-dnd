import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api } from "../../api/client";
import type { CharacterGM } from "../../api/types";
import { useHotkeys } from "../../hooks/useHotkeys";
import { useJobRunner } from "../../hooks/useJobPolling";
import { useToast } from "../../hooks/useToast";
import { useFlowStore } from "../../store/flow";
import { useUiStore } from "../../store/ui";
import { describeError } from "../../utils/errors";
import { formatElapsed } from "../../utils/format";
import { IconButton } from "../ui/IconButton";
import { ActorHeader } from "./ActorHeader";
import { DieGlyph, RetryGlyph, SparkGlyph, TrashGlyph } from "./icons";

/** Ограничение совпадает с серверной схемой хода. */
const MAX_LENGTH = 30_000;
const SKELETON_WIDTHS = [88, 96, 72, 91, 84, 46];

export function TurnComposer({
  campaignId,
  eventId,
  character,
  onTurnPublished,
  onChanged,
  onPickCharacter,
}: {
  campaignId: string;
  eventId: string;
  character: CharacterGM | undefined;
  /** `notifyObserver` — отдавать ли ход Наблюдателю на разбор. */
  onTurnPublished: (turnId: string, notifyObserver: boolean) => void;
  onChanged: () => void;
  onPickCharacter: () => void;
}) {
  const toast = useToast();
  const setBusy = useFlowStore((state) => state.setBusy);
  const notifyObserver = useUiStore((state) => state.notifyObserver);
  const setNotifyObserver = useUiStore((state) => state.setNotifyObserver);
  const [thought, setThought] = useState("");
  const [action, setAction] = useState("");
  const [emptyAction, setEmptyAction] = useState(false);
  /* Ход можно написать и без модели: тогда пустые поля открываются явно, а не
     подменяют пустое состояние на первом же символе. */
  const [manual, setManual] = useState(false);

  const createTurn = useMutation({
    mutationFn: ({ rollDice }: { rollDice: boolean }) =>
      api.createTurn(campaignId, eventId, {
        character_id: character?.id ?? null,
        actor_name: character?.name ?? "Game Master",
        actor_role: character?.role ?? "gm",
        thought: thought.trim() || undefined,
        action: action.trim(),
        roll_dice: rollDice,
      }),
    onSuccess: (turn) => {
      setThought("");
      setAction("");
      setEmptyAction(false);
      setManual(false);
      onTurnPublished(turn.id, notifyObserver);
      onChanged();
    },
    onError: (error) =>
      toast.push({
        tone: "error",
        title: "Ход не опубликован",
        description: describeError(error),
      }),
  });

  const generateTurn = useJobRunner({
    start: () => {
      if (!character) throw new Error("Сначала выберите персонажа.");
      return api.generatePlayerTurn(campaignId, eventId, character.id);
    },
    fetchJob: (jobId) => api.getJob(campaignId, jobId),
    parse: (job) => {
      const output = job.output_data;
      if (!output || typeof output.thought !== "string" || typeof output.action !== "string") {
        throw new Error("Модель вернула неполный черновик.");
      }
      return { thought: output.thought, action: output.action };
    },
    describeFailure: (job) => `Не удалось создать черновик: ${job.error_code ?? job.status}`,
    timeoutMessage: "Модель не ответила вовремя.",
    onSuccess: (draft) => {
      setThought(draft.thought);
      setAction(draft.action);
      setEmptyAction(false);
    },
  });

  const { isPending: generating, elapsedMs, cancel, error: generateError } = generateTurn;
  const status = character ? `${character.name} обдумывает ход…` : "Модель отвечает…";

  useEffect(() => {
    if (!generating) return;
    setBusy({ stage: 2, label: status, elapsedMs, onCancel: cancel });
    return () => setBusy(null);
  }, [cancel, elapsedMs, generating, setBusy, status]);

  useEffect(() => {
    if (!generateError) return;
    toast.push({
      tone: "error",
      title: "Черновик не получен",
      description: describeError(generateError),
    });
  }, [generateError, toast]);

  const publish = (rollDice: boolean) => {
    if (!action.trim()) {
      setEmptyAction(true);
      return;
    }
    createTurn.mutate({ rollDice });
  };
  const clearDraft = () => {
    setThought("");
    setAction("");
    setEmptyAction(false);
    setManual(false);
    generateTurn.reset();
  };

  const hasDraft = manual || Boolean(thought || action);

  useHotkeys([
    {
      code: "KeyG",
      enabled: Boolean(character) && !generating,
      handler: () => generateTurn.run(),
    },
  ]);

  return (
    <>
      <div className="panel-head">
        <h2 className="panel-head__title panel-head__title--model">Ответ модели-игрока</h2>
        <div className="panel-head__actions">
          <IconButton
            label="Сгенерировать заново"
            icon={<RetryGlyph size={14} />}
            disabled={!character || generating}
            onClick={() => generateTurn.run()}
          />
          <IconButton
            label="Очистить черновик"
            icon={<TrashGlyph size={14} />}
            disabled={!hasDraft || createTurn.isPending}
            onClick={clearDraft}
          />
        </div>
      </div>

      <ActorHeader character={character} onPick={onPickCharacter} />

      <div className="composer">
        {generating ? (
          <div className="composer__generating">
            <p className="composer__generating-status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              {status}
              <span className="mono">{formatElapsed(elapsedMs)}</span>
              <button type="button" className="btn btn--ghost btn--compact" onClick={cancel}>
                Отменить
              </button>
            </p>
            <div className="skeleton" aria-hidden="true">
              {SKELETON_WIDTHS.map((width, index) => (
                <i key={index} style={{ width: `${width}%` }} />
              ))}
            </div>
          </div>
        ) : hasDraft ? (
          <div className="composer__draft">
            <label className="composer__field composer__field--thought">
              <span className="composer__field-label">
                Мысль
                <span className="scope-tag">не идёт в контекст других моделей</span>
                <span className="composer__count mono">
                  {thought.length} / {MAX_LENGTH.toLocaleString("ru-RU")}
                </span>
              </span>
              <textarea
                aria-label="Мысль модели"
                value={thought}
                maxLength={MAX_LENGTH}
                onChange={(event) => setThought(event.target.value)}
              />
            </label>

            <label className="composer__field composer__field--action">
              <span className="composer__field-label">
                Действие
                <span className="scope-tag scope-tag--public">идёт в контекст всем</span>
                <span className="composer__count mono">
                  {action.length} / {MAX_LENGTH.toLocaleString("ru-RU")}
                </span>
              </span>
              <textarea
                aria-label="Публичное действие"
                value={action}
                maxLength={MAX_LENGTH}
                aria-invalid={emptyAction}
                autoFocus={manual}
                onChange={(event) => {
                  setAction(event.target.value);
                  if (emptyAction) setEmptyAction(false);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
                  event.preventDefault();
                  publish(event.shiftKey);
                }}
              />
            </label>
            {emptyAction && (
              <span className="field-error" role="alert">
                Действие не может быть пустым — это то, что увидят зрители.
              </span>
            )}
          </div>
        ) : (
          <div className="composer__idle">
            <button
              type="button"
              className="btn btn--model btn--large"
              disabled={!character}
              onClick={() => generateTurn.run()}
            >
              <SparkGlyph size={16} />
              Сгенерировать ход
            </button>
            <p>
              Модель получит биографию, характеристики, хронику, приватную память и текущий лог
              события. Черновик можно отредактировать перед публикацией.
            </p>
            <button type="button" className="btn btn--compact" onClick={() => setManual(true)}>
              Написать ход вручную
            </button>
          </div>
        )}
      </div>

      {hasDraft && !generating && (
        <div className="composer__actions">
          <button
            type="button"
            className="btn"
            aria-label="Отправить"
            disabled={!character || createTurn.isPending}
            onClick={() => publish(false)}
          >
            Отправить <kbd>Ctrl+⏎</kbd>
          </button>
          <button
            type="button"
            className="btn btn--gm"
            aria-label="Отправить с броском d20"
            disabled={!character || createTurn.isPending}
            onClick={() => publish(true)}
          >
            <DieGlyph size={14} />
            Бросок d20 <kbd>⇧Ctrl+⏎</kbd>
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={notifyObserver}
            aria-label="Отправлять ход Наблюдателю"
            title={
              notifyObserver
                ? "Наблюдатель разберёт ход сразу после публикации"
                : "Ход уйдёт только в лог и на зрительский экран"
            }
            className={`composer__observer-toggle${notifyObserver ? " is-on" : ""}`}
            onClick={() => setNotifyObserver(!notifyObserver)}
          >
            <span>Наблюдателю</span>
            <span className="switch" aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}
