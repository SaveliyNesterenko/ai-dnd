import type { CharacterPublic } from "../api/types";
import { ResourceBar } from "./ResourceBar";

interface CharacterCardProps {
  character: CharacterPublic;
  selected?: boolean;
  onSelect?: (character: CharacterPublic) => void;
  compact?: boolean;
}

export function CharacterCard({
  character,
  selected = false,
  onSelect,
  compact = false,
}: CharacterCardProps) {
  const body = (
    <>
      <div className="character-card__identity">
        <div className="character-card__portrait" aria-hidden="true">
          {character.sprite_url ? (
            <img src={character.sprite_url} alt="" />
          ) : (
            <span>{character.name.slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div>
          <strong>{character.name}</strong>
          <small>{character.role}</small>
        </div>
      </div>
      <ResourceBar
        label="HP"
        current={character.hp_current}
        maximum={character.hp_max}
        tone="health"
      />
      <ResourceBar
        label="MP"
        current={character.mp_current}
        maximum={character.mp_max}
        tone="mana"
      />
      {!compact && character.status_effects.length > 0 && (
        <div className="chips" aria-label="Статусные эффекты">
          {character.status_effects.map((effect) => (
            <span className="chip" key={effect}>
              {effect}
            </span>
          ))}
        </div>
      )}
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        className={`character-card ${selected ? "character-card--selected" : ""}`}
        onClick={() => onSelect(character)}
        aria-pressed={selected}
      >
        {body}
      </button>
    );
  }
  return <article className="character-card">{body}</article>;
}
