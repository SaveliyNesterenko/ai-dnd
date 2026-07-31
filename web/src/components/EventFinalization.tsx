import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { api } from "../api/client";
import type { GameStateSnapshot } from "../api/types";
import { ErrorNotice } from "./ErrorNotice";
import { Dialog } from "./ui/Dialog";

interface FinalizationDraft {
  chronicle: string;
  playerNotes: Record<string, string>;
  source: "llm" | "manual";
}

export function EventFinalization({
  campaignId,
  snapshot,
  onChanged,
}: {
  campaignId: string;
  snapshot: GameStateSnapshot;
  onChanged: () => void;
}) {
  const event = snapshot.active_event;
  const [draft, setDraft] = useState<FinalizationDraft | null>(null);
  const [open, setOpen] = useState(event?.status === "finalizing");
  const participants = useMemo(
    () =>
      snapshot.characters.filter((character) =>
        event?.participant_ids.includes(character.id),
      ),
    [event?.participant_ids, snapshot.characters],
  );
  const players = useMemo(
    () => participants.filter((character) => character.kind === "player"),
    [participants],
  );
  const job = useQuery({
    queryKey: ["event-finalization-job", campaignId, event?.finalization_job_id],
    queryFn: () => api.getJob(campaignId, event!.finalization_job_id!),
    enabled: event?.status === "finalizing" && Boolean(event.finalization_job_id),
    refetchInterval: (query) =>
      ["queued", "running"].includes(query.state.data?.status ?? "") ? 700 : false,
  });

  const generate = useMutation({
    mutationFn: () =>
      api.generateEventFinalization(campaignId, event!.id, event!.revision),
    onSuccess: () => {
      setDraft(null);
      setOpen(true);
      onChanged();
    },
  });
  const confirm = useMutation({
    mutationFn: (value: FinalizationDraft) =>
      api.confirmEventFinalization(campaignId, event!.id, {
        base_revision: event!.revision,
        chronicle: value.chronicle.trim(),
        player_notes: Object.fromEntries(
          Object.entries(value.playerNotes).map(([id, note]) => [id, note.trim()]),
        ),
        source: value.source,
      }),
    onSuccess: () => {
      setOpen(false);
      onChanged();
    },
  });

  if (!event) return null;
  if (event.status === "active") {
    return (
      <button
        className="button button--quiet"
        type="button"
        disabled={generate.isPending}
        onClick={() => generate.mutate()}
      >
        {generate.isPending ? "Запускаем Архивариуса…" : "Завершить событие"}
      </button>
    );
  }
  if (event.status !== "finalizing") return null;

  const jobFailed = ["failed", "degraded", "cancelled"].includes(job.data?.status ?? "");
  const jobSucceeded = job.data?.status === "succeeded";
  const jobWorking =
    Boolean(event.finalization_job_id) &&
    (job.isPending || ["queued", "running"].includes(job.data?.status ?? ""));
  const createManualDraft = () => {
    const priorChronicles = participants
      .flatMap((character) =>
        "global_chronicle" in character ? character.global_chronicle : [],
      )
      .filter((value, index, all) => all.indexOf(value) === index);
    setDraft({
      chronicle: priorChronicles.join("\n\n"),
      playerNotes: Object.fromEntries(
        players.map((character) => [
          character.id,
          "private_notes" in character ? character.private_notes.join("\n\n") : "",
        ]),
      ),
      source: "manual",
    });
  };
  const openGeneratedDraft = () => {
    const output = job.data?.output_data;
    if (
      typeof output?.chronicle !== "string" ||
      typeof output.player_notes !== "object" ||
      output.player_notes === null
    ) {
      return;
    }
    setDraft({
      chronicle: output.chronicle,
      playerNotes: Object.fromEntries(
        Object.entries(output.player_notes).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
      source: "llm",
    });
  };
  const filledCount =
    (draft?.chronicle.trim() ? 1 : 0) +
    players.filter((player) => draft?.playerNotes[player.id]?.trim()).length;
  const draftComplete =
    Boolean(draft?.chronicle.trim()) &&
    players.every((player) => Boolean(draft?.playerNotes[player.id]?.trim()));

  return (
    <>
      <button className="button button--quiet" type="button" onClick={() => setOpen(true)}>
        Событие завершается
      </button>
      {open && (
        <Dialog
          title="Событие завершается"
          eyebrow="Архивариус"
          tone="archivist"
          size="l"
          onClose={() => setOpen(false)}
          headerExtra={<span className="finalization__safe">Лог сохранён</span>}
          footer={
            draft ? (
              <>
                <span className="finalization__progress">
                  {draftComplete
                    ? "Готово к сохранению"
                    : `Заполнено ${filledCount} из ${players.length + 1}`}
                </span>
                <span className="spacer" />
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={confirm.isPending}
                  onClick={() => setDraft(null)}
                >
                  Отложить
                </button>
                <button
                  type="button"
                  className="btn btn--gm"
                  disabled={!draftComplete || confirm.isPending}
                  onClick={() => confirm.mutate(draft)}
                >
                  {confirm.isPending ? "Сохраняем память…" : "Сохранить и завершить"}
                </button>
              </>
            ) : null
          }
        >
          <div className="finalization" aria-live="polite">
            {jobWorking && (
              <p className="finalization__working">
                <span className="spinner spinner--archivist" aria-hidden="true" />
                Архивариус объединяет общую хронику, а модели игроков обновляют собственные
                личные воспоминания…
              </p>
            )}

            {jobFailed && !draft && (
              <div className="finalization__notice" role="alert">
                <strong>Архивариус или модель игрока сейчас недоступны.</strong>
                <p>
                  Ничего не потеряно: событие, все ходы и прежняя память сохранены. Можно
                  повторить запрос или ввести итог вручную.
                </p>
              </div>
            )}

            {!event.finalization_job_id && !draft && (
              <p className="finalization__lead">
                Автоматический черновик не запускался. Создайте его или внесите итог вручную.
              </p>
            )}

            {!draft && !jobWorking && (
              <div className="finalization__actions">
                {jobSucceeded ? (
                  <button type="button" className="btn btn--gm" onClick={openGeneratedDraft}>
                    Проверить черновик
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    disabled={generate.isPending}
                    onClick={() => generate.mutate()}
                  >
                    {generate.isPending ? "Повторяем…" : "Повторить"}
                  </button>
                )}
                <button type="button" className="btn btn--ghost" onClick={createManualDraft}>
                  Ввести результат вручную
                </button>
              </div>
            )}

            {draft && (
              <>
                <p className="finalization__lead">
                  Память изменится только после «Сохранить и завершить». Черновик пока не
                  отправлен ни одной модели.
                </p>
                <div className="finalization__grid">
                  <label className="finalization__chronicle">
                    <span className="finalization__label">
                      Общая хроника участников
                      <FilledMark filled={Boolean(draft.chronicle.trim())} />
                    </span>
                    <textarea
                      aria-label="Общая хроника участников"
                      value={draft.chronicle}
                      onChange={(change) =>
                        setDraft((current) =>
                          current ? { ...current, chronicle: change.target.value } : current,
                        )
                      }
                    />
                  </label>

                  {/* Стопка, а не вкладки: draftComplete требует заполнить все
                      заметки, и спрятанная за корешком пустая объясняла бы,
                      почему кнопка сохранения неактивна, только после клика. */}
                  <div className="finalization__notes">
                    {players.map((player) => (
                      <label className="finalization__player-note" key={player.id}>
                        <span className="finalization__label">
                          Личное воспоминание · {player.name}
                          <FilledMark
                            filled={Boolean(draft.playerNotes[player.id]?.trim())}
                          />
                        </span>
                        <textarea
                          value={draft.playerNotes[player.id] ?? ""}
                          onChange={(change) =>
                            setDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    playerNotes: {
                                      ...current.playerNotes,
                                      [player.id]: change.target.value,
                                    },
                                  }
                                : current,
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}

            {(generate.error || job.error || confirm.error) && (
              <ErrorNotice error={generate.error ?? job.error ?? confirm.error} />
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}

/** Точка заполненности: показывает, чего не хватает, без клика по вкладке. */
function FilledMark({ filled }: { filled: boolean }) {
  return (
    <span
      className={`filled-mark${filled ? " is-filled" : ""}`}
      role="img"
      aria-label={filled ? "заполнено" : "не заполнено"}
    />
  );
}
