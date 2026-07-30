import { useEffect, useRef, useState } from "react";

import type { CharacterGM, GameStateSnapshot } from "../../api/types";
import type { TurnView } from "../../api/generated/types.gen";
import { formatClock, pluralTurns } from "../../utils/format";
import { KindGlyph, ThoughtGlyph } from "./icons";

/** Ниже этого расстояния от низа считаем, что ГМ читает свежие ходы. */
const STICK_TO_BOTTOM_PX = 80;

export function EventLog({
  snapshot,
  characters,
  compressing,
  onCompress,
}: {
  snapshot: GameStateSnapshot;
  characters: CharacterGM[];
  compressing: boolean;
  onCompress: () => void;
}) {
  const activeEvent = snapshot.active_event;
  const throughSequence = activeEvent?.context_summary_through_sequence ?? 0;
  const liveTurns = activeEvent?.turns.filter((turn) => turn.sequence > throughSequence) ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const lastTurnId = liveTurns.at(-1)?.id;

  /* Новый ход подкручивает лог только если ГМ и так внизу: иначе он теряет
     место, куда смотрел. */
  useEffect(() => {
    if (!atBottom || !lastTurnId) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [atBottom, lastTurnId]);

  const scrollToLatest = () => {
    const node = scrollRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  };

  return (
    <>
      <div className="panel-head">
        <h2 className="panel-head__title panel-head__title--gm">Лог события</h2>
        <span className="panel-head__aside mono">
          {activeEvent
            ? `${activeEvent.turns.length} ${pluralTurns(activeEvent.turns.length)}`
            : "нет события"}
        </span>
      </div>

      {activeEvent && (
        <ContextMeter
          summarised={throughSequence}
          live={liveTurns.length}
          canCompress={activeEvent.status === "active"}
          compressing={compressing}
          onCompress={onCompress}
        />
      )}

      <div
        className="event-log"
        ref={scrollRef}
        aria-live="polite"
        onScroll={(event) => {
          const node = event.currentTarget;
          setAtBottom(
            node.scrollHeight - node.scrollTop - node.clientHeight < STICK_TO_BOTTOM_PX,
          );
        }}
      >
        {!activeEvent && (
          <p className="event-log__empty">
            Лог появится после запуска события. Всё, что скажете вы и модели, соберётся здесь.
          </p>
        )}

        {activeEvent?.context_summary && (
          <article className="log-entry log-entry--archivist">
            <header className="log-entry__meta">
              <span className="log-entry__seq mono">
                {throughSequence > 1 ? `01–${pad(throughSequence)}` : pad(throughSequence)}
              </span>
              <span className="log-entry__who">Архивариус · сжатый контекст</span>
            </header>
            <p className="log-entry__action">{activeEvent.context_summary}</p>
          </article>
        )}

        {liveTurns.map((turn) => (
          <LogEntry
            key={turn.id}
            turn={turn}
            character={characters.find((item) => item.id === turn.character_id)}
          />
        ))}

        {!atBottom && liveTurns.length > 0 && (
          <button type="button" className="jump-to-latest" onClick={scrollToLatest}>
            ↓ к последнему ходу
          </button>
        )}
      </div>
    </>
  );
}

function LogEntry({ turn, character }: { turn: TurnView; character: CharacterGM | undefined }) {
  const isGm = turn.character_id === null;
  return (
    <article className={`log-entry log-entry--${isGm ? "gm" : "model"}`}>
      <header className="log-entry__meta">
        <span className="log-entry__seq mono">{pad(turn.sequence)}</span>
        <span className="log-entry__who">
          {!isGm && character && (
            <span
              className={`log-entry__kind log-entry__kind--${character.kind}`}
              aria-hidden="true"
            >
              <KindGlyph kind={character.kind} size={11} />
            </span>
          )}
          {turn.actor_name}
        </span>
        <time className="log-entry__time mono" dateTime={turn.created_at}>
          {formatClock(turn.created_at)}
        </time>
      </header>

      {turn.thought && (
        <p className="log-entry__thought" title="Не идёт в контекст других моделей">
          <ThoughtGlyph size={12} />
          <span>{turn.thought}</span>
        </p>
      )}

      <p className="log-entry__action">{turn.action}</p>

      {turn.dice_roll !== null && (
        <p className="log-entry__foot">
          <span className="die-token mono">d20 · {turn.dice_roll}</span>
        </p>
      )}
    </article>
  );
}

function ContextMeter({
  summarised,
  live,
  canCompress,
  compressing,
  onCompress,
}: {
  summarised: number;
  live: number;
  canCompress: boolean;
  compressing: boolean;
  onCompress: () => void;
}) {
  const total = summarised + live;
  const summarisedShare = total === 0 ? 0 : (summarised / total) * 100;
  const liveShare = total === 0 ? 0 : (live / total) * 100;
  return (
    <div className="context-meter">
      <span className="context-meter__label">Контекст</span>
      <span
        className="context-meter__bar"
        role="img"
        aria-label={`Сжато ходов: ${summarised}, живых: ${live}`}
      >
        <i className="context-meter__part context-meter__part--summarised" style={{ width: `${summarisedShare}%` }} />
        <i className="context-meter__part context-meter__part--live" style={{ width: `${liveShare}%` }} />
      </span>
      <span className="context-meter__legend mono">
        сжато: {summarised} · живых: {live}
      </span>
      {canCompress && (
        <button
          type="button"
          className="mini-button mini-button--archivist"
          disabled={compressing || live === 0}
          onClick={onCompress}
        >
          {compressing ? "Сжимаем…" : "Сжать"}
        </button>
      )}
    </div>
  );
}

const pad = (value: number) => String(value).padStart(2, "0");
