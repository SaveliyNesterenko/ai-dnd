import type { CharacterPublic } from "../api/types";

interface CharacterCardProps {
  character: CharacterPublic;
  onOpen?: (character: CharacterPublic) => void;
}

export function CharacterCard({ character, onOpen }: CharacterCardProps) {
  const portrait = character.portrait_url ?? character.sprite_url;
  const body = (
    <>
      <div className="character-card__portrait" aria-hidden="true">
        {portrait ? (
          <img src={portrait} alt="" />
        ) : (
          <span>{character.name.slice(0, 1).toUpperCase()}</span>
        )}
      </div>
      <div className="character-card__name">{character.name}</div>
      <div className="character-card__model">{modelLabel(character.model_id)}</div>
      <CardResource label="HP" current={character.hp_current} maximum={character.hp_max} tone="health" />
      <CardResource label="MP" current={character.mp_current} maximum={character.mp_max} tone="mana" />
    </>
  );

  if (!onOpen) {
    return <article className="character-card">{body}</article>;
  }
  return (
    <button
      type="button"
      className="character-card"
      aria-label={`Открыть сведения: ${character.name}`}
      onClick={() => onOpen(character)}
    >
      {body}
    </button>
  );
}

function CardResource({
  label,
  current,
  maximum,
  tone,
}: {
  label: string;
  current: number;
  maximum: number;
  tone: "health" | "mana";
}) {
  const percentage = maximum > 0 ? Math.max(0, Math.min(100, (current / maximum) * 100)) : 0;
  return (
    <div className="character-card__bar" aria-label={`${label}: ${current} из ${maximum}`}>
      <div
        className={`character-card__bar-fill character-card__bar-fill--${tone}`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

/**
 * Имя модели на карточке зрителя показывается коротко: провайдер отбрасывается,
 * как это делал legacy-экран.
 */
function modelLabel(modelId: string | null | undefined) {
  const trimmed = (modelId ?? "").trim();
  if (!trimmed) return "N/A";
  const short = trimmed.includes("yandex") ? trimmed : (trimmed.split("/").pop() ?? trimmed);
  return short.replace(/-preview$/, "");
}
