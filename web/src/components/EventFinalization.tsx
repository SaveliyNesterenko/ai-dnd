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
          onClose={() => setOpen(false)}
          headerExtra={<span className="finalization__safe">Лог сохранён</span>}
        >
          <div className="finalization" aria-live="polite">
              {jobWorking && (
                <p>
                  Архивариус объединяет общую хронику, а модели игроков обновляют
                  собственные личные воспоминания…
                </p>
              )}
              {jobFailed && !draft && (
                <div className="finalization__notice" role="alert">
                  <strong>Архивариус или модель игрока сейчас недоступны.</strong>
                  <p>
                    Ничего не потеряно: событие, все ходы и прежняя память сохранены.
                    Можно повторить запрос или ввести итог вручную.
                  </p>
                </div>
              )}
              {!event.finalization_job_id && !draft && (
                <p>
                  Автоматический черновик не запускался. Создайте его или внесите итог
                  вручную.
                </p>
              )}
              {!draft && !jobWorking && (
                <div className="finalization__actions">
                  {jobSucceeded ? (
                    <button className="button" type="button" onClick={openGeneratedDraft}>
                      Проверить черновик
                    </button>
                  ) : (
                    <button
                      className="button button--secondary"
                      type="button"
                      disabled={generate.isPending}
                      onClick={() => generate.mutate()}
                    >
                      {generate.isPending ? "Повторяем…" : "Повторить"}
                    </button>
                  )}
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={createManualDraft}
                  >
                    Ввести результат вручную
                  </button>
                </div>
              )}
              {draft && (
                <div className="finalization__draft">
                  <p>Память изменится только после нажатия «Сохранить и завершить».</p>
                  <label htmlFor="archive-chronicle">Общая хроника участников</label>
                  <textarea
                    id="archive-chronicle"
                    rows={10}
                    value={draft.chronicle}
                    onChange={(change) =>
                      setDraft((current) =>
                        current
                          ? { ...current, chronicle: change.target.value }
                          : current,
                      )
                    }
                  />
                  {players.map((player) => (
                    <label className="finalization__player-note" key={player.id}>
                      <span>Личное воспоминание · {player.name}</span>
                      <textarea
                        rows={5}
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
                  <div className="finalization__actions">
                    <button
                      className="button"
                      type="button"
                      disabled={!draftComplete || confirm.isPending}
                      onClick={() => confirm.mutate(draft)}
                    >
                      {confirm.isPending
                        ? "Сохраняем память…"
                        : "Сохранить и завершить"}
                    </button>
                    <button
                      className="button button--quiet"
                      type="button"
                      disabled={confirm.isPending}
                      onClick={() => setDraft(null)}
                    >
                      Отложить
                    </button>
                  </div>
                </div>
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
