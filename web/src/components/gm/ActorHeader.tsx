import type { CharacterGM } from "../../api/types";
import { kindLabel } from "../../utils/format";
import { KindGlyph } from "./icons";

/**
 * Шапка композера: решение о ходе принимается здесь, значит здесь же должны
 * быть портрет, вид персонажа, модель и запас ресурсов.
 */
export function ActorHeader({
  character,
  onPick,
}: {
  character: CharacterGM | undefined;
  onPick: () => void;
}) {
  if (!character) {
    return (
      <div className="actor-header actor-header--empty">
        <span className="actor-header__none">Персонаж не выбран</span>
        <button type="button" className="mini-button" onClick={onPick}>
          Выбрать персонажа
        </button>
      </div>
    );
  }

  return (
    <div className="actor-header">
      <span className="actor-header__portrait" aria-hidden="true">
        {character.portrait_url ? (
          <img src={character.portrait_url} alt="" />
        ) : (
          character.name.slice(0, 1)
        )}
      </span>
      <div className="actor-header__identity">
        <p className="actor-header__name">{character.name}</p>
        <p className="actor-header__meta">
          <span className={`actor-header__kind actor-header__kind--${character.kind}`}>
            <KindGlyph kind={character.kind} size={11} />
            {kindLabel(character.kind)}
          </span>
          {character.model_id && <span className="mono">{character.model_id}</span>}
        </p>
      </div>
      <div className="actor-header__resources">
        <ResourceLine
          label="HP"
          tone="health"
          current={character.hp_current}
          maximum={character.hp_max}
        />
        <ResourceLine
          label="MP"
          tone="mana"
          current={character.mp_current}
          maximum={character.mp_max}
        />
      </div>
    </div>
  );
}

function ResourceLine({
  label,
  tone,
  current,
  maximum,
}: {
  label: string;
  tone: "health" | "mana";
  current: number;
  maximum: number;
}) {
  const share = maximum > 0 ? Math.min(100, Math.max(0, (current / maximum) * 100)) : 0;
  return (
    <div className="resource-line" aria-label={`${label}: ${current} из ${maximum}`}>
      <span className="resource-line__label">{label}</span>
      <span className="resource-line__track" aria-hidden="true">
        <i className={`resource-line__fill resource-line__fill--${tone}`} style={{ width: `${share}%` }} />
      </span>
      <span className="resource-line__value mono">
        {current}/{maximum}
      </span>
    </div>
  );
}
