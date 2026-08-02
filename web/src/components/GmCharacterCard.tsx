import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import type { CharacterGM, InventoryItem } from "../api/types";
import type { SceneCharacterView } from "../api/generated/types.gen";
import { ErrorNotice } from "./ErrorNotice";
import { SpeakerOffGlyph } from "./gm/icons";
import { Dialog } from "./ui/Dialog";

type CardBack = "attributes" | "resources" | null;
type Editor = "profile" | "inventory" | "effects" | null;
type InventoryDraft = InventoryItem & { clientKey: string };
type AttributeDraft = { clientKey: string; name: string; value: number };
type ProfileDraft = {
  name: string;
  kind: CharacterGM["kind"];
  role: string;
  modelId: string;
  biography: string;
  attributes: AttributeDraft[];
  globalChronicle: string[];
  privateNotes: string[];
};

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
  const [profile, setProfile] = useState<ProfileDraft>(() => profileFromCharacter(character));
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
  const openProfile = () => {
    setProfile(profileFromCharacter(character));
    setEditor("profile");
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
                {/* Нет образца голоса — реплики этого персонажа уйдут к
                    зрителю текстом, и узнать об этом лучше заранее. */}
                {!character.voice_asset_id && (
                  <span
                    className="gm-character-card__voiceless"
                    role="img"
                    aria-label={`${character.name}: нет образца голоса`}
                    title="Нет образца голоса — реплики уйдут без озвучки"
                  >
                    <SpeakerOffGlyph size={13} />
                  </span>
                )}
                <span
                  className={`gm-character-card__kind gm-character-card__kind--${character.kind}`}
                  role="img"
                  aria-label={categoryLabel(character.kind)}
                  title={categoryLabel(character.kind)}
                >
                  <KindIcon kind={character.kind} />
                </span>
                <button
                  className="gm-character-card__edit"
                  type="button"
                  aria-label={`Редактировать персонажа ${character.name}`}
                  title="Редактировать персонажа"
                  onClick={(event) => {
                    event.stopPropagation();
                    openProfile();
                  }}
                >
                  <PencilIcon />
                </button>
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
      {editor === "profile" && (
        <EditorDialog
          title={`Персонаж · ${character.name}`}
          onClose={() => setEditor(null)}
          footer={
            <>
              <span className="character-profile-editor__hint">
                Изменения повлияют на следующие ответы персонажа.
              </span>
              <button
                className="button"
                type="button"
                style={{ marginLeft: "auto" }}
                disabled={
                  update.isPending ||
                  !profile.name.trim() ||
                  !profile.role.trim() ||
                  profile.attributes.some((attribute) => !attribute.name.trim()) ||
                  new Set(profile.attributes.map((attribute) => attribute.name.trim())).size !==
                    profile.attributes.length
                }
                onClick={() =>
                  update.mutate({
                    base_revision: character.revision,
                    name: profile.name,
                    kind: profile.kind,
                    role: profile.role,
                    model_id: profile.modelId || null,
                    biography: profile.biography,
                    attributes: Object.fromEntries(
                      profile.attributes.map((attribute) => [
                        attribute.name.trim(),
                        attribute.value,
                      ]),
                    ),
                    global_chronicle: profile.globalChronicle,
                    private_notes: profile.privateNotes,
                  })
                }
              >
                Сохранить персонажа
              </button>
            </>
          }
        >
          <div className="character-profile-editor">
            <section className="character-profile-editor__section">
              <h3>Основные сведения</h3>
              <div className="character-profile-editor__grid">
                <EditorField label="Имя">
                  <input
                    value={profile.name}
                    maxLength={160}
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </EditorField>
                <EditorField label="Тип">
                  <select
                    value={profile.kind}
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        kind: event.target.value as CharacterGM["kind"],
                      }))
                    }
                  >
                    <option value="player">Игрок</option>
                    <option value="npc">NPC</option>
                    <option value="enemy">Враг</option>
                  </select>
                </EditorField>
                <EditorField label="Роль">
                  <input
                    value={profile.role}
                    maxLength={64}
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, role: event.target.value }))
                    }
                  />
                </EditorField>
                <EditorField label="Модель ИИ" hint="Пусто — модель кампании по умолчанию">
                  <input
                    value={profile.modelId}
                    maxLength={160}
                    placeholder="По умолчанию"
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, modelId: event.target.value }))
                    }
                  />
                </EditorField>
              </div>
              <EditorField label="Биография">
                <textarea
                  rows={6}
                  value={profile.biography}
                  maxLength={50_000}
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, biography: event.target.value }))
                  }
                />
              </EditorField>
            </section>

            <section className="character-profile-editor__section">
              <div className="character-profile-editor__section-head">
                <h3>Характеристики</h3>
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() =>
                    setProfile((current) => ({
                      ...current,
                      attributes: [
                        ...current.attributes,
                        { clientKey: crypto.randomUUID(), name: "", value: 0 },
                      ],
                    }))
                  }
                >
                  Добавить
                </button>
              </div>
              <div className="character-editor-list">
                {profile.attributes.map((attribute) => (
                  <div className="attribute-editor-row" key={attribute.clientKey}>
                    <input
                      aria-label="Название характеристики"
                      value={attribute.name}
                      maxLength={32}
                      placeholder="Название"
                      onChange={(event) =>
                        setProfile((current) => ({
                          ...current,
                          attributes: current.attributes.map((item) =>
                            item.clientKey === attribute.clientKey
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        }))
                      }
                    />
                    <input
                      aria-label={`Значение характеристики ${attribute.name || "без названия"}`}
                      type="number"
                      value={attribute.value}
                      onChange={(event) =>
                        setProfile((current) => ({
                          ...current,
                          attributes: current.attributes.map((item) =>
                            item.clientKey === attribute.clientKey
                              ? { ...item, value: Number(event.target.value) }
                              : item,
                          ),
                        }))
                      }
                    />
                    <button
                      className="button button--quiet"
                      type="button"
                      onClick={() =>
                        setProfile((current) => ({
                          ...current,
                          attributes: current.attributes.filter(
                            (item) => item.clientKey !== attribute.clientKey,
                          ),
                        }))
                      }
                    >
                      Удалить
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <TextListEditor
              title="Личная хроника"
              hint="Факты, которые модель использует как память персонажа."
              values={profile.globalChronicle}
              onChange={(globalChronicle) =>
                setProfile((current) => ({ ...current, globalChronicle }))
              }
            />
            <TextListEditor
              title="Закрытые заметки ГМ-а"
              hint="Не показываются зрителям и другим персонажам."
              values={profile.privateNotes}
              onChange={(privateNotes) =>
                setProfile((current) => ({ ...current, privateNotes }))
              }
            />
          </div>
          {update.error && <ErrorNotice error={update.error} />}
        </EditorDialog>
      )}
      {editor === "inventory" && (
        <EditorDialog
          title={`Инвентарь · ${character.name}`}
          onClose={() => setEditor(null)}
          footer={
            <>
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
                style={{ marginLeft: "auto" }}
                disabled={update.isPending || inventory.some((item) => !item.name.trim())}
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
            </>
          }
        >
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
          {update.error && <ErrorNotice error={update.error} />}
        </EditorDialog>
      )}
      {editor === "effects" && (
        <EditorDialog
          title={`Статусные эффекты · ${character.name}`}
          onClose={() => setEditor(null)}
          footer={
            <>
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
                style={{ marginLeft: "auto" }}
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
            </>
          }
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
          {update.error && <ErrorNotice error={update.error} />}
        </EditorDialog>
      )}
    </>
  );
}

function profileFromCharacter(character: CharacterGM): ProfileDraft {
  return {
    name: character.name,
    kind: character.kind,
    role: character.role,
    modelId: character.model_id ?? "",
    biography: character.biography,
    attributes: Object.entries(character.attributes).map(([name, value]) => ({
      clientKey: crypto.randomUUID(),
      name,
      value,
    })),
    globalChronicle: [...character.global_chronicle],
    privateNotes: [...character.private_notes],
  };
}

function EditorField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="character-profile-editor__field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function TextListEditor({
  title,
  hint,
  values,
  onChange,
}: {
  title: string;
  hint: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <section className="character-profile-editor__section">
      <div className="character-profile-editor__section-head">
        <div>
          <h3>{title}</h3>
          <p>{hint}</p>
        </div>
        <button
          className="button button--secondary"
          type="button"
          onClick={() => onChange([...values, ""])}
        >
          Добавить
        </button>
      </div>
      <div className="character-editor-list">
        {values.map((value, index) => (
          <div className="memory-editor-row" key={index}>
            <textarea
              rows={2}
              aria-label={`${title}, запись ${index + 1}`}
              value={value}
              maxLength={10_000}
              onChange={(event) =>
                onChange(values.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))
              }
            />
            <button
              className="button button--quiet"
              type="button"
              onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
            >
              Удалить
            </button>
          </div>
        ))}
      </div>
    </section>
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

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
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
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Dialog title={title} size="l" onClose={onClose} footer={footer}>
      {children}
    </Dialog>
  );
}
