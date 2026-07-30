import { useMemo, useState, type RefObject } from "react";

import type { CharacterGM, GameStateSnapshot } from "../../api/types";
import { Popover } from "../ui/Popover";
import { kindLabel } from "../../utils/format";
import { KindGlyph } from "./icons";

export function CharacterPicker({
  anchorRef,
  open,
  onClose,
  characters,
  scene,
  pending,
  locked,
  onToggle,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  characters: CharacterGM[];
  scene: GameStateSnapshot["scene"];
  pending: boolean;
  locked: boolean;
  onToggle: (characterId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const onSceneIds = useMemo(
    () =>
      new Set(
        scene.characters.filter((state) => state.is_visible).map((state) => state.character_id),
      ),
    [scene.characters],
  );

  const matches = characters.filter((character) =>
    character.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  /* Сначала те, кто на сцене: их состав меняют чаще, чем добавляют новых. */
  const onScene = matches.filter((character) => onSceneIds.has(character.id));
  const offScene = matches.filter((character) => !onSceneIds.has(character.id));

  return (
    <Popover anchorRef={anchorRef} open={open} onClose={onClose} label="Персонажи на сцене">
      <input
        className="popover__search"
        type="search"
        value={query}
        placeholder="Поиск…"
        aria-label="Поиск персонажа"
        onChange={(event) => setQuery(event.target.value)}
      />

      <PickerGroup
        title="На сцене"
        characters={onScene}
        checked
        pending={pending || locked}
        onToggle={onToggle}
      />
      {offScene.length > 0 && <hr className="popover__rule" />}
      <PickerGroup
        title="Не на сцене"
        characters={offScene}
        checked={false}
        pending={pending || locked}
        onToggle={onToggle}
      />
      {matches.length === 0 && <p className="popover__empty">Никого не нашлось.</p>}
    </Popover>
  );
}

function PickerGroup({
  title,
  characters,
  checked,
  pending,
  onToggle,
}: {
  title: string;
  characters: CharacterGM[];
  checked: boolean;
  pending: boolean;
  onToggle: (characterId: string) => void;
}) {
  if (characters.length === 0) return null;
  return (
    <>
      <p className="popover__title">{title}</p>
      <ul className="popover__list">
        {characters.map((character) => (
          <li key={character.id}>
            <button
              type="button"
              role="switch"
              aria-checked={checked}
              className="picker-row"
              disabled={pending}
              onClick={() => onToggle(character.id)}
            >
              <span className="picker-row__portrait" aria-hidden="true">
                {character.portrait_url ? (
                  <img src={character.portrait_url} alt="" />
                ) : (
                  character.name.slice(0, 1)
                )}
              </span>
              <span className="picker-row__text">
                <span className="picker-row__name">{character.name}</span>
                <span className="picker-row__meta">
                  <span className={`picker-row__kind picker-row__kind--${character.kind}`}>
                    <KindGlyph kind={character.kind} size={11} />
                    {kindLabel(character.kind)}
                  </span>
                  {character.model_id && <span className="mono">{character.model_id}</span>}
                </span>
              </span>
              <span className="switch" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
