import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api } from "../api/client";
import type { CharacterGM, InventoryItem } from "../api/types";
import type { SceneCharacterView } from "../api/generated/types.gen";
import { ErrorNotice } from "./ErrorNotice";

type CardBack = "attributes" | "resources" | null;
type Editor = "inventory" | "effects" | null;
type InventoryDraft = InventoryItem & { clientKey: string };

export function GmCharacterCard({
  campaignId,
  character,
  sceneState,
  selected,
  onSelect,
  onRemove,
  onChanged,
}: {
  campaignId: string;
  character: CharacterGM;
  sceneState: SceneCharacterView | undefined;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onChanged: () => void;
}) {
  const [back, setBack] = useState<CardBack>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [resources, setResources] = useState({
    hpCurrent: character.hp_current,
    hpMax: character.hp_max,
    mpCurrent: character.mp_current,
    mpMax: character.mp_max,
  });
  const [inventory, setInventory] = useState<InventoryDraft[]>([]);
  const [effects, setEffects] = useState<string[]>([]);
  const update = useMutation({
    mutationFn: (input: Parameters<typeof api.updateCharacter>[2]) =>
      api.updateCharacter(campaignId, character.id, input),
    onSuccess: () => {
      setBack(null);
      setEditor(null);
      onChanged();
    },
  });

  const flipped = sceneState?.flip_x ?? character.flip_x;
  const flip = useMutation({
    mutationFn: () => {
      if (!sceneState) throw new Error("Персонаж ещё не размещён на сцене.");
      return api.updateSceneCharacter(campaignId, character.id, {
        flip_x: !flipped,
        base_revision: sceneState.revision,
      });
    },
    onSuccess: onChanged,
  });

  const openResources = () => {
    setResources({
      hpCurrent: character.hp_current,
      hpMax: character.hp_max,
      mpCurrent: character.mp_current,
      mpMax: character.mp_max,
    });
    setBack("resources");
  };
  const openInventory = () => {
    setInventory(
      character.inventory.map((item) => ({
        ...item,
        clientKey: item.id ?? crypto.randomUUID(),
      })),
    );
    setEditor("inventory");
  };
  const openEffects = () => {
    setEffects([...character.status_effects]);
    setEditor("effects");
  };

  return (
    <>
      <article
        className={`gm-character-card ${selected ? "gm-character-card--selected" : ""} ${
          back ? "gm-character-card--flipped" : ""
        }`}
        onClick={onSelect}
      >
        <div className="gm-character-card__inner">
          <section className="gm-character-card__face gm-character-card__front">
            {character.portrait_url && (
              <img
                className="gm-character-card__art"
                src={character.portrait_url}
                alt=""
              />
            )}
            <div className="gm-character-card__veil" />
            <div className="gm-character-card__content">
              <div className="gm-character-card__corner">
                <button
                  className="gm-character-card__flip"
                  type="button"
                  aria-label={`Отразить аватар ${character.name} по горизонтали. Сейчас смотрит ${
                    flipped ? "вправо" : "влево"
                  }`}
                  aria-pressed={flipped}
                  title="Отразить аватар по горизонтали"
                  disabled={!sceneState || flip.isPending}
                  onClick={(event) => {
                    event.stopPropagation();
                    flip.mutate();
                  }}
                >
                  <FlipIcon />
                </button>
                <span
                  className={`gm-character-card__kind gm-character-card__kind--${character.kind}`}
                  role="img"
                  aria-label={categoryLabel(character.kind)}
                  title={categoryLabel(character.kind)}
                >
                  <KindIcon kind={character.kind} />
                </span>
              </div>
              <button
                className="gm-character-card__remove"
                type="button"
                aria-label={`Скрыть карточку ${character.name}`}
                title="Скрыть карточку"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove();
                }}
              >
                <CloseIcon />
              </button>
              <h3>{character.name}</h3>
              <div className="gm-character-card__buttons">
                <CardButton label="HP / MP" symbol="E" onClick={openResources} />
                <CardButton
                  label="Характеристики"
                  symbol="✦"
                  onClick={() => setBack("attributes")}
                />
                <CardButton label="Статусные эффекты" symbol="S" onClick={openEffects} />
                <CardButton label="Инвентарь" symbol="I" onClick={openInventory} />
              </div>
              {flip.error && <ErrorNotice error={flip.error} />}
            </div>
          </section>
          <section
            className="gm-character-card__face gm-character-card__back"
            title="Нажмите на карточку, чтобы вернуться"
            onClick={(event) => {
              event.stopPropagation();
              setBack(null);
            }}
          >
            {back === "attributes" && (
              <>
                <h3>Характеристики</h3>
                <div className="gm-character-card__attributes">
                  {Object.entries(character.attributes).map(([name, value]) => (
                    <div key={name}>
                      <span>{name}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
              </>
            )}
            {back === "resources" && (
              <form
                className="gm-character-card__resource-form"
                onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                  event.preventDefault();
                  update.mutate({
                    base_revision: character.revision,
                    hp_current: resources.hpCurrent,
                    hp_max: resources.hpMax,
                    mp_current: resources.mpCurrent,
                    mp_max: resources.mpMax,
                  });
                }}
              >
                <ResourceInputs
                  label="HP"
                  current={resources.hpCurrent}
                  maximum={resources.hpMax}
                  onCurrent={(value) =>
                    setResources((current) => ({ ...current, hpCurrent: value }))
                  }
                  onMaximum={(value) =>
                    setResources((current) => ({ ...current, hpMax: value }))
                  }
                />
                <ResourceInputs
                  label="MP"
                  current={resources.mpCurrent}
                  maximum={resources.mpMax}
                  onCurrent={(value) =>
                    setResources((current) => ({ ...current, mpCurrent: value }))
                  }
                  onMaximum={(value) =>
                    setResources((current) => ({ ...current, mpMax: value }))
                  }
                />
                <button
                  className="button"
                  type="submit"
                  disabled={
                    update.isPending ||
                    resources.hpCurrent > resources.hpMax ||
                    resources.mpCurrent > resources.mpMax
                  }
                >
                  Сохранить
                </button>
                {update.error && <ErrorNotice error={update.error} />}
              </form>
            )}
            <p className="gm-character-card__hint">клик — назад</p>
          </section>
        </div>
      </article>
      {editor === "inventory" && (
        <EditorDialog title={`Инвентарь · ${character.name}`} onClose={() => setEditor(null)}>
          <div className="character-editor-list">
            {inventory.map((item, index) => (
              <div className="inventory-editor-row" key={item.clientKey}>
                <input
                  aria-label={`Название предмета ${index + 1}`}
                  value={item.name}
                  placeholder="Название"
                  onChange={(event) =>
                    setInventory((current) =>
                      current.map((candidate) =>
                        candidate.clientKey === item.clientKey
                          ? { ...candidate, name: event.target.value }
                          : candidate,
                      ),
                    )
                  }
                />
                <input
                  aria-label={`Количество предмета ${index + 1}`}
                  type="number"
                  min={0}
                  value={item.quantity}
                  onChange={(event) =>
                    setInventory((current) =>
                      current.map((candidate) =>
                        candidate.clientKey === item.clientKey
                          ? { ...candidate, quantity: Number(event.target.value) }
                          : candidate,
                      ),
                    )
                  }
                />
                <input
                  aria-label={`Описание предмета ${index + 1}`}
                  value={item.description}
                  placeholder="Описание"
                  onChange={(event) =>
                    setInventory((current) =>
                      current.map((candidate) =>
                        candidate.clientKey === item.clientKey
                          ? { ...candidate, description: event.target.value }
                          : candidate,
                      ),
                    )
                  }
                />
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={() =>
                    setInventory((current) =>
                      current.filter((candidate) => candidate.clientKey !== item.clientKey),
                    )
                  }
                >
                  Удалить
                </button>
              </div>
            ))}
          </div>
          <div className="character-editor-actions">
            <button
              className="button button--secondary"
              type="button"
              onClick={() =>
                setInventory((current) => [
                  ...current,
                  {
                    id: null,
                    name: "",
                    quantity: 1,
                    description: "",
                    clientKey: crypto.randomUUID(),
                  },
                ])
              }
            >
              Добавить предмет
            </button>
            <button
              className="button"
              type="button"
              disabled={
                update.isPending || inventory.some((item) => !item.name.trim())
              }
              onClick={() =>
                update.mutate({
                  base_revision: character.revision,
                  inventory: inventory.map((item) => ({
                    id: item.id,
                    name: item.name,
                    quantity: item.quantity,
                    description: item.description,
                  })),
                })
              }
            >
              Сохранить
            </button>
          </div>
          {update.error && <ErrorNotice error={update.error} />}
        </EditorDialog>
      )}
      {editor === "effects" && (
        <EditorDialog
          title={`Статусные эффекты · ${character.name}`}
          onClose={() => setEditor(null)}
        >
          <div className="character-editor-list">
            {effects.map((effect, index) => (
              <div className="effect-editor-row" key={index}>
                <input
                  aria-label={`Статусный эффект ${index + 1}`}
                  value={effect}
                  onChange={(event) =>
                    setEffects((current) =>
                      current.map((value, itemIndex) =>
                        itemIndex === index ? event.target.value : value,
                      ),
                    )
                  }
                />
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={() =>
                    setEffects((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  Удалить
                </button>
              </div>
            ))}
          </div>
          <div className="character-editor-actions">
            <button
              className="button button--secondary"
              type="button"
              onClick={() => setEffects((current) => [...current, ""])}
            >
              Добавить эффект
            </button>
            <button
              className="button"
              type="button"
              disabled={update.isPending || effects.some((effect) => !effect.trim())}
              onClick={() =>
                update.mutate({
                  base_revision: character.revision,
                  status_effects: effects,
                })
              }
            >
              Сохранить
            </button>
          </div>
          {update.error && <ErrorNotice error={update.error} />}
        </EditorDialog>
      )}
    </>
  );
}

/** Две встречные стрелки: аватар отражается по горизонтали. */
function FlipIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 9h16" />
      <path d="M17 6l3 3-3 3" />
      <path d="M20 15H4" />
      <path d="M7 12l-3 3 3 3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
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

/** Категория персонажа значком: щит — игрок, силуэт — NPC, череп — враг. */
function KindIcon({ kind }: { kind: CharacterGM["kind"] }) {
  const paths = {
    player: <path d="M12 3l7 3v5.5c0 4.4-2.9 7.4-7 8.5-4.1-1.1-7-4.1-7-8.5V6z" />,
    npc: (
      <>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
      </>
    ),
    enemy: (
      <>
        <path d="M12 3.4c-3.9 0-6.6 2.6-6.6 6.2 0 1.9.8 3.4 2.1 4.4v2c0 .8.7 1.5 1.5 1.5h6c.8 0 1.5-.7 1.5-1.5v-2c1.3-1 2.1-2.5 2.1-4.4 0-3.6-2.7-6.2-6.6-6.2Z" />
        <circle cx="9.6" cy="10" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="14.4" cy="10" r="1.4" fill="currentColor" stroke="none" />
        <path d="M12 13.2v1.6" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[kind]}
    </svg>
  );
}

function categoryLabel(kind: CharacterGM["kind"]) {
  return { player: "Игрок", npc: "NPC", enemy: "Враг" }[kind];
}

function CardButton({
  label,
  symbol,
  onClick,
}: {
  label: string;
  symbol: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {symbol}
    </button>
  );
}

function ResourceInputs({
  label,
  current,
  maximum,
  onCurrent,
  onMaximum,
}: {
  label: string;
  current: number;
  maximum: number;
  onCurrent: (value: number) => void;
  onMaximum: (value: number) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <div>
        <input
          aria-label={`${label}, текущее`}
          type="number"
          min={0}
          value={current}
          onChange={(event) => onCurrent(Number(event.target.value))}
        />
        <span>/</span>
        <input
          aria-label={`${label}, максимум`}
          type="number"
          min={0}
          value={maximum}
          onChange={(event) => onMaximum(Number(event.target.value))}
        />
      </div>
    </label>
  );
}

function EditorDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="character-editor-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="character-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button
            type="button"
            className="button button--quiet"
            onClick={onClose}
            autoFocus
          >
            Закрыть
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
