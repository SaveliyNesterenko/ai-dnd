import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { api } from "../../api/client";
import type {
  CharacterGM,
  GameStateSnapshot,
  ObserverOperation,
  ObserverProposal,
} from "../../api/types";
import { useJobRunner } from "../../hooks/useJobPolling";
import { useToast } from "../../hooks/useToast";
import { useFlowStore } from "../../store/flow";
import { describeError } from "../../utils/errors";
import { formatElapsed } from "../../utils/format";
import { describeOperation, parseOperations } from "../../utils/observerOperations";
import { IconButton } from "../ui/IconButton";
import { RetryGlyph } from "./icons";

export function ObserverPanel({
  campaignId,
  snapshot,
  characters,
  requestedTurnId,
  proposal,
  setProposal,
  onApplied,
  onChanged,
}: {
  campaignId: string;
  snapshot: GameStateSnapshot;
  characters: CharacterGM[];
  requestedTurnId: string | undefined;
  proposal: ObserverProposal | null;
  setProposal: (proposal: ObserverProposal | null) => void;
  onApplied: (turnId: string) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const setBusy = useFlowStore((state) => state.setBusy);
  const [brief, setBrief] = useState("");
  const [operations, setOperations] = useState<ObserverOperation[]>([]);
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set());
  const [briefExpanded, setBriefExpanded] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState("[]");
  const [jsonError, setJsonError] = useState<string>();
  const [trail, setTrail] = useState<{ count: number } | null>(null);

  const activeEvent = snapshot.active_event;
  const lastTurn = activeEvent?.turns.at(-1);
  const eventAcceptsChanges = activeEvent?.status === "active";
  const requestedTurnExists = activeEvent?.turns.some((turn) => turn.id === requestedTurnId);

  /* Строки и JSON — два вида одного состояния, поэтому текст пересобирается
     здесь, а не в эффекте: иначе правка в поле и перерисовка гонялись бы. */
  const putOperations = (next: ObserverOperation[]) => {
    setOperations(next);
    setJsonText(JSON.stringify(next, null, 2));
    setJsonError(undefined);
  };

  const loadProposal = (next: ObserverProposal) => {
    setProposal(next);
    setBrief(next.gm_brief);
    setSkipped(new Set());
    setTrail(null);
    setBriefExpanded(false);
    putOperations(next.operations as ObserverOperation[]);
  };

  const reset = () => {
    setProposal(null);
    setBrief("");
    setSkipped(new Set());
    setBriefExpanded(false);
    putOperations([]);
  };

  const generate = useJobRunner({
    start: (turnId: string) => api.generateObserver(campaignId, activeEvent!.id, turnId),
    fetchJob: (jobId) => api.getJob(campaignId, jobId),
    parse: (job) => {
      const proposalId = job.output_data?.proposal_id;
      if (typeof proposalId !== "string") throw new Error("Наблюдатель не вернул предложение.");
      return api.getProposal(campaignId, proposalId);
    },
    describeFailure: (job) => `Наблюдатель недоступен: ${job.error_code ?? job.status}`,
    timeoutMessage: "Наблюдатель не ответил вовремя.",
    onSuccess: loadProposal,
  });

  const createManual = useMutation({
    mutationFn: () =>
      api.createProposal(campaignId, activeEvent!.id, {
        turn_id: lastTurn!.id,
        gm_brief: brief.trim() || "Ручное предложение GM.",
        base_revision: snapshot.campaign.revision,
        operations,
      }),
    onSuccess: loadProposal,
    onError: (error) =>
      toast.push({
        tone: "error",
        title: "Предложение не создано",
        description: describeError(error),
      }),
  });

  const selectedOperations = operations.filter((_, index) => !skipped.has(index));
  const apply = useMutation({
    mutationFn: () =>
      api.applyProposal(campaignId, proposal!.id, brief.trim(), selectedOperations),
    onSuccess: () => {
      const count = selectedOperations.length;
      if (proposal) onApplied(proposal.turn_id);
      reset();
      setTrail({ count });
      toast.push({
        tone: "observer",
        title: "Изменения применены",
        description: `Механика обновлена: ${count} ${pluralChanges(count)}.`,
      });
      onChanged();
    },
    onError: (error) =>
      toast.push({
        tone: "error",
        title: "Изменения не применились",
        description: describeError(error),
      }),
  });

  const { isPending: generating, elapsedMs, cancel, error: generateError } = generate;
  useEffect(() => {
    if (!generating) return;
    setBusy({ stage: 3, label: "Наблюдатель разбирает ход…", elapsedMs, onCancel: cancel });
    return () => setBusy(null);
  }, [cancel, elapsedMs, generating, setBusy]);

  useEffect(() => {
    if (!generateError) return;
    toast.push({
      tone: "error",
      title: "Наблюдатель не ответил",
      description: describeError(generateError),
    });
  }, [generateError, toast]);

  /* Ход опубликован — предложение запрашивается само, но ровно один раз. */
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

  const header = (
    <div className="panel-head">
      <h2 className="panel-head__title panel-head__title--observer">Наблюдатель</h2>
      <span className="panel-head__aside mono">rev {snapshot.campaign.revision}</span>
    </div>
  );

  if (!eventAcceptsChanges || !lastTurn) {
    return (
      <>
        {header}
        <div className="observer-empty">
          <ObserverEye />
          {activeEvent?.status === "finalizing" ? (
            <>
              <h3>Механика заморожена</h3>
              <p>
                Пока Архивариус сводит итог события, изменения не принимаются. Лог и прежняя
                память в безопасности.
              </p>
            </>
          ) : (
            <>
              <h3>Ожидает публичного действия</h3>
              <p>
                Наблюдатель разберёт последний ход и предложит ограниченный набор изменений.
                Они вступят в силу только после вашего подтверждения.
              </p>
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {header}

      <div className="observer-body">
        {generating && (
          <p className="observer-status" aria-live="polite">
            <span className="spinner spinner--observer" aria-hidden="true" />
            Наблюдатель разбирает ход…
            <span className="mono">{formatElapsed(elapsedMs)}</span>
            <button type="button" className="btn btn--ghost btn--compact" onClick={cancel}>
              Отменить
            </button>
          </p>
        )}

        {trail && !proposal && (
          <p className="observer-trail">
            <CheckGlyph />
            Применено {trail.count} {pluralChanges(trail.count)}
          </p>
        )}

        {!proposal && !generating && (
          <div className="observer-intro">
            <p>
              Наблюдатель проверит публичное действие последнего хода и предложит изменения
              механики. Ничего не поменяется без вашего подтверждения.
            </p>
            <div className="observer-actions">
              <button
                type="button"
                className="btn btn--observer"
                onClick={() => generate.run(lastTurn.id)}
              >
                Запустить Наблюдателя
              </button>
              <button
                type="button"
                className="btn"
                disabled={createManual.isPending}
                onClick={() => createManual.mutate()}
              >
                Создать вручную
              </button>
            </div>
          </div>
        )}

        {proposal && (
          <>
            <section className="observer-brief">
              <div className="observer-section-head">
                <h3>GM Brief</h3>
                <button
                  type="button"
                  className="mini-button"
                  aria-expanded={briefExpanded}
                  onClick={() => setBriefExpanded((value) => !value)}
                >
                  {briefExpanded ? "свернуть" : "развернуть"}
                </button>
              </div>
              <textarea
                className={`observer-brief__text${briefExpanded ? " is-expanded" : ""}`}
                aria-label="GM Brief"
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
              />
            </section>

            <section className="observer-ops">
              <div className="observer-section-head">
                <h3>Предлагаемые изменения</h3>
                <span className="count-pill count-pill--observer">{operations.length}</span>
              </div>

              {operations.length === 0 ? (
                <p className="observer-ops__empty">
                  Наблюдатель не предложил изменений — механика остаётся как есть.
                </p>
              ) : (
                <ul className="observer-ops__list">
                  {operations.map((operation, index) => (
                    <OperationRow
                      key={index}
                      operation={operation}
                      characters={characters}
                      enabled={!skipped.has(index)}
                      onToggle={() =>
                        setSkipped((current) => {
                          const next = new Set(current);
                          if (next.has(index)) next.delete(index);
                          else next.add(index);
                          return next;
                        })
                      }
                      onChange={(next) =>
                        putOperations(operations.map((item, i) => (i === index ? next : item)))
                      }
                      onRemove={() => {
                        putOperations(operations.filter((_, i) => i !== index));
                        setSkipped(new Set());
                      }}
                    />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      <div className="observer-foot">
        {proposal && (
          <div className="observer-actions">
            <button
              type="button"
              className="btn btn--observer"
              disabled={apply.isPending || !brief.trim()}
              onClick={() => apply.mutate()}
            >
              Применить ({selectedOperations.length})
            </button>
            <IconButton
              label="Перегенерировать предложение"
              icon={<RetryGlyph size={14} />}
              disabled={generating}
              onClick={() => generate.run(lastTurn.id)}
            />
            <button type="button" className="btn btn--ghost" onClick={reset}>
              Сбросить
            </button>
          </div>
        )}

        <button
          type="button"
          className="json-toggle mono"
          aria-expanded={jsonOpen}
          onClick={() => setJsonOpen((value) => !value)}
        >
          {"{ }"} {jsonOpen ? "скрыть" : "показать"} JSON операций
        </button>

        {jsonOpen && (
          <div className="json-editor">
            <textarea
              aria-label="Typed operations · JSON"
              spellCheck={false}
              value={jsonText}
              onChange={(event) => {
                setJsonText(event.target.value);
                try {
                  setOperations(parseOperations(JSON.parse(event.target.value)));
                  setSkipped(new Set());
                  setJsonError(undefined);
                } catch (error) {
                  setJsonError(describeError(error));
                }
              }}
            />
            {jsonError && (
              <span className="field-error" role="alert">
                {jsonError}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function OperationRow({
  operation,
  characters,
  enabled,
  onToggle,
  onChange,
  onRemove,
}: {
  operation: ObserverOperation;
  characters: CharacterGM[];
  enabled: boolean;
  onToggle: () => void;
  onChange: (operation: ObserverOperation) => void;
  onRemove: () => void;
}) {
  const summary = describeOperation(
    operation,
    characters.find((item) => item.id === operation.character_id),
  );
  const character = characters.find((item) => item.id === summary.characterId);

  return (
    <li className={`operation-row${enabled ? "" : " is-skipped"}`}>
      <input
        type="checkbox"
        checked={enabled}
        aria-label={`Применить: ${character?.name ?? "персонаж"} · ${summary.label} ${summary.text}`}
        onChange={onToggle}
      />

      <span className="operation-row__portrait" aria-hidden="true">
        {character?.portrait_url ? (
          <img src={character.portrait_url} alt="" />
        ) : (
          (character?.name ?? "?").slice(0, 1)
        )}
      </span>

      <span className="operation-row__text">
        <span className="operation-row__who">{character?.name ?? "Неизвестный персонаж"}</span>
        <span className="operation-row__what">
          <b>{summary.label}</b> {summary.text}
          {summary.tag && <span className="operation-tag">{summary.tag}</span>}
          {summary.delta !== undefined && summary.delta !== 0 && (
            <span className={`delta delta--${summary.delta > 0 ? "up" : "down"}`}>
              {summary.delta > 0 ? "+" : ""}
              {summary.delta}
            </span>
          )}
        </span>
      </span>

      {summary.editable ? (
        <input
          className="operation-row__value mono"
          type="number"
          aria-label={`Значение: ${summary.label}`}
          value={summary.editable.value}
          onChange={(event) => onChange(summary.editable!.update(Number(event.target.value)))}
        />
      ) : (
        <IconButton label="Убрать операцию" icon={<CrossGlyph />} tone="danger" onClick={onRemove} />
      )}
    </li>
  );
}

function pluralChanges(count: number) {
  const tail = count % 100;
  if (tail > 10 && tail < 20) return "изменений";
  switch (count % 10) {
    case 1:
      return "изменение";
    case 2:
    case 3:
    case 4:
      return "изменения";
    default:
      return "изменений";
  }
}

function ObserverEye() {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--role-observer)"
      strokeWidth="1.4"
      opacity="0.5"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function CrossGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 5l14 14" />
      <path d="M19 5L5 19" />
    </svg>
  );
}
