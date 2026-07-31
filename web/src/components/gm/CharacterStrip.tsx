import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../../api/client";
import type { CharacterGM, GameStateSnapshot } from "../../api/types";
import { useToast } from "../../hooks/useToast";
import { useUiStore } from "../../store/ui";
import { describeError } from "../../utils/errors";
import { GmCharacterCard } from "../GmCharacterCard";
import { ChevronDown, ChevronUp } from "./icons";

/**
 * Обвязка ленты. Сама карточка не меняется — здесь только порядок, сворачивание
 * и связь выделения с композером. Порядок виден зрителю, поэтому перетаскивание
 * сразу пишется в состояние сцены.
 */
export function CharacterStrip({
  campaignId,
  snapshot,
  characters,
  onAddCharacter,
  onRemoveCharacter,
  onChanged,
}: {
  campaignId: string;
  snapshot: GameStateSnapshot;
  characters: CharacterGM[];
  onAddCharacter: () => void;
  onRemoveCharacter: (characterId: string) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const selectedCharacterId = useUiStore((state) => state.selectedCharacterId);
  const selectCharacter = useUiStore((state) => state.selectCharacter);
  const collapsed = useUiStore((state) => state.stripCollapsed);
  const toggleStrip = useUiStore((state) => state.toggleStrip);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const visible = snapshot.scene.characters
    .filter((state) => state.is_visible)
    .sort((left, right) => left.order - right.order);
  const ordered = visible
    .map((state) => characters.find((character) => character.id === state.character_id))
    .filter((character): character is CharacterGM => Boolean(character));

  const reorder = useMutation({
    mutationFn: async (nextIds: string[]) => {
      /* Пишем только тех, у кого порядок реально изменился: каждая запись
         тратит ревизию строки сцены. */
      const changed = nextIds
        .map((characterId, order) => ({ characterId, order }))
        .filter(({ characterId, order }) => {
          const state = visible.find((item) => item.character_id === characterId);
          return state && state.order !== order;
        });
      for (const { characterId, order } of changed) {
        const state = visible.find((item) => item.character_id === characterId)!;
        await api.updateSceneCharacter(campaignId, characterId, {
          order,
          base_revision: state.revision,
        });
      }
    },
    onSuccess: onChanged,
    onError: (error) => {
      onChanged();
      toast.push({
        tone: "error",
        title: "Порядок не сохранился",
        description: describeError(error),
      });
    },
  });

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= ordered.length) return;
    const nextIds = ordered.map((character) => character.id);
    const [moved] = nextIds.splice(from, 1);
    nextIds.splice(to, 0, moved!);
    reorder.mutate(nextIds);
  };

  const endDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <section
      className={`slab character-strip-panel${collapsed ? " is-collapsed" : ""}`}
      aria-label="Карточки персонажей"
    >
      <div className="strip-head">
        <h2 className="strip-head__title">Персонажи</h2>
        <span className="count-pill">{ordered.length}</span>
        {!collapsed && ordered.length > 1 && (
          <span className="strip-head__hint">
            перетащите карточку или Ctrl+←/→ — порядок увидит зритель
          </span>
        )}
        <button type="button" className="mini-button strip-head__add" onClick={onAddCharacter}>
          + Добавить
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={collapsed ? "Развернуть ленту персонажей" : "Свернуть ленту персонажей"}
          aria-expanded={!collapsed}
          onClick={toggleStrip}
        >
          {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      {collapsed ? (
        <div className="strip-rail">
          {ordered.length === 0 && <span className="strip-rail__empty">Никого на сцене</span>}
          {ordered.map((character) => (
            <button
              key={character.id}
              type="button"
              className={`strip-rail__chip${
                character.id === selectedCharacterId ? " is-selected" : ""
              }`}
              onClick={() => selectCharacter(character.id)}
            >
              {character.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="strip-viewport">
          <ul className="gm-character-strip">
            {ordered.length === 0 && (
              <li className="gm-character-strip__empty">
                Никого на сцене. Добавьте персонажей — здесь появятся их карточки.
              </li>
            )}
            {ordered.map((character, index) => (
              <li
                key={character.id}
                className={`strip-item${dragIndex === index ? " is-dragging" : ""}${
                  overIndex === index && dragIndex !== null && dragIndex !== index
                    ? " is-drop-target"
                    : ""
                }`}
                draggable
                tabIndex={0}
                aria-label={`${character.name}, позиция ${index + 1} из ${ordered.length}`}
                onDragStart={(event) => {
                  /* Внутри карточки есть поля и кнопки — оттуда тянуть нельзя,
                     иначе не выделить текст и не нажать счётчик HP. */
                  if ((event.target as HTMLElement).closest("input, textarea, button")) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", character.id);
                  setDragIndex(index);
                }}
                onDragOver={(event) => {
                  if (dragIndex === null) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setOverIndex(index);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragIndex !== null) move(dragIndex, index);
                  endDrag();
                }}
                onDragEnd={endDrag}
                onKeyDown={(event) => {
                  if (!event.ctrlKey) return;
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    move(index, index - 1);
                  } else if (event.key === "ArrowRight") {
                    event.preventDefault();
                    move(index, index + 1);
                  }
                }}
              >
                <GmCharacterCard
                  campaignId={campaignId}
                  character={character}
                  sceneState={snapshot.scene.characters.find(
                    (state) => state.character_id === character.id,
                  )}
                  selected={character.id === selectedCharacterId}
                  onSelect={() => selectCharacter(character.id)}
                  onRemove={() => onRemoveCharacter(character.id)}
                  onChanged={onChanged}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
