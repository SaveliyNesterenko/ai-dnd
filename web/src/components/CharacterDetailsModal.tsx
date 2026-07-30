import { useEffect } from "react";

import type { CharacterPublic } from "../api/types";
import { ResourceBar } from "./ResourceBar";

export function CharacterDetailsModal({
  character,
  onClose,
}: {
  character: CharacterPublic;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const portrait = character.portrait_url ?? character.sprite_url;
  const attributes = Object.entries(character.attributes);

  return (
    <div
      className="character-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="character-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Сведения о персонаже: ${character.name}`}
      >
        <button
          className="character-modal__close"
          type="button"
          aria-label="Закрыть сведения"
          onClick={onClose}
          autoFocus
        >
          ×
        </button>

        <div className="character-modal__left">
          <div className="character-modal__portrait">
            {portrait ? (
              <img src={portrait} alt="" />
            ) : (
              <span aria-hidden="true">{character.name.slice(0, 1).toUpperCase()}</span>
            )}
          </div>
          <h2 className="character-modal__name">{character.name}</h2>
          <span className="character-modal__role">{categoryLabel(character.kind)}</span>
          <div className="character-modal__resources">
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
          </div>
        </div>

        <div className="character-modal__right">
          <h3 className="character-modal__section">Биография</h3>
          <p className="character-modal__bio">{character.biography || "Нет данных"}</p>

          <h3 className="character-modal__section">Характеристики</h3>
          {attributes.length > 0 ? (
            <div className="character-modal__attributes">
              {attributes.map(([name, value]) => (
                <div key={name}>
                  <span>{name}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="character-modal__empty">Нет данных</p>
          )}

          <h3 className="character-modal__section">Статусные эффекты</h3>
          {character.status_effects.length > 0 ? (
            <div className="chips" aria-label="Статусные эффекты">
              {character.status_effects.map((effect) => (
                <span className="chip" key={effect}>
                  {effect}
                </span>
              ))}
            </div>
          ) : (
            <p className="character-modal__empty">Нет</p>
          )}

          <h3 className="character-modal__section">Инвентарь</h3>
          {character.inventory.length > 0 ? (
            <ul className="character-modal__inventory">
              {character.inventory.map((item, index) => (
                <li key={item.id ?? `${item.name}-${index}`}>
                  <strong>{item.name}</strong>
                  <span>×{item.quantity}</span>
                  {item.description && <small>{item.description}</small>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="character-modal__empty">Пусто</p>
          )}
        </div>
      </section>
    </div>
  );
}

function categoryLabel(category: CharacterPublic["kind"]) {
  return {
    player: "Игрок",
    npc: "NPC",
    enemy: "Враг",
  }[category];
}
