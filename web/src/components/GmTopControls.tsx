import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { api } from "../api/client";
import type { Campaign, CharacterGM, GameStateSnapshot } from "../api/types";
import { ErrorNotice } from "./ErrorNotice";
import { EventFinalization } from "./EventFinalization";

export function GmTopControls({
  campaignId,
  campaigns,
  campaignSelectionPending,
  campaignSelectionError,
  onSelectCampaign,
  snapshot,
  characters,
  spectatorCode,
  onToggleCharacter,
  characterSelectionPending,
  characterSelectionError,
  onChanged,
}: {
  campaignId: string;
  campaigns: Campaign[];
  campaignSelectionPending: boolean;
  campaignSelectionError: unknown;
  onSelectCampaign: (campaignId: string) => void;
  snapshot: GameStateSnapshot;
  characters: CharacterGM[];
  spectatorCode?: string;
  onToggleCharacter: (characterId: string) => void;
  characterSelectionPending: boolean;
  characterSelectionError: unknown;
  onChanged: () => void;
}) {
  const scene = snapshot.scene;
  const [volume, setVolume] = useState(scene.music_volume);
  const [avatarSize, setAvatarSize] = useState(scene.avatar_size);
  const visibleStates = useMemo(
    () =>
      scene.characters
        .filter((state) => state.is_visible)
        .sort((left, right) => left.order - right.order),
    [scene.characters],
  );
  const visibleCharacterIds = useMemo(
    () => new Set(visibleStates.map((state) => state.character_id)),
    [visibleStates],
  );
  const updateScene = useMutation({
    mutationFn: (input: Parameters<typeof api.updateScene>[1]) =>
      api.updateScene(campaignId, input),
    onSuccess: onChanged,
  });
  const startEvent = useMutation({
    mutationFn: () => api.startEvent(campaignId, "Новое игровое событие"),
    onSuccess: onChanged,
  });

  const updateSceneField = (
    input: Omit<Parameters<typeof api.updateScene>[1], "base_revision">,
  ) => {
    updateScene.mutate({ ...input, base_revision: scene.revision });
  };
  const finalizing = snapshot.active_event?.status === "finalizing";
  const eventError = startEvent.error;
  const error =
    campaignSelectionError ??
    updateScene.error ??
    characterSelectionError ??
    eventError;

  return (
    <div className="gm-top-controls">
      <label className="top-control top-control--campaign">
        <span>Кампания</span>
        <select
          aria-label="Активная кампания"
          value={campaignId}
          disabled={campaignSelectionPending}
          onChange={(event) => onSelectCampaign(event.target.value)}
        >
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.name}
            </option>
          ))}
        </select>
      </label>

      <label className="top-control top-control--character">
        <span>Персонажи</span>
        <select
          aria-label="Выбрать персонажа"
          value=""
          disabled={characterSelectionPending || finalizing}
          onChange={(event) => {
            const characterId = event.target.value;
            if (!characterId) return;
            onToggleCharacter(characterId);
          }}
        >
          <option value="">Выберите персонажа…</option>
          {characters.map((character) => (
            <option key={character.id} value={character.id}>
              {visibleCharacterIds.has(character.id) ? "✓ " : ""}
              {character.name} · {categoryLabel(character.kind)}
            </option>
          ))}
        </select>
      </label>

      <label className="top-control top-control--location">
        <span>Карта</span>
        <select
          aria-label="Карта"
          value={scene.location_id ?? ""}
          disabled={updateScene.isPending || finalizing}
          onChange={(event) => updateSceneField({ location_id: event.target.value })}
        >
          {scene.locations.length === 0 && <option value="">Нет карт</option>}
          {scene.locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>

      <label className="top-control top-control--music">
        <span>Музыка</span>
        <select
          aria-label="Музыка"
          value={scene.music_track_id ?? ""}
          disabled={updateScene.isPending || finalizing}
          onChange={(event) =>
            updateSceneField({ music_track_id: event.target.value })
          }
        >
          {scene.music_tracks.length === 0 && <option value="">Нет музыки</option>}
          {scene.music_tracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.name}
            </option>
          ))}
        </select>
      </label>

      <div className="top-music-actions" aria-label="Управление музыкой">
        <button
          className="button button--quiet"
          type="button"
          disabled={
            !scene.music_track_id ||
            scene.music_is_playing ||
            updateScene.isPending ||
            finalizing
          }
          onClick={() => updateSceneField({ music_is_playing: true })}
        >
          Play
        </button>
        <button
          className="button button--quiet"
          type="button"
          disabled={!scene.music_is_playing || updateScene.isPending || finalizing}
          onClick={() => updateSceneField({ music_is_playing: false })}
        >
          Stop
        </button>
      </div>

      <label className="top-control top-control--volume">
        <span>Громкость {volume}%</span>
        <input
          aria-label={`Громкость ${volume}%`}
          type="range"
          min={0}
          max={100}
          value={volume}
          disabled={updateScene.isPending || finalizing}
          onChange={(event) => setVolume(Number(event.target.value))}
          onPointerUp={() => {
            if (volume !== scene.music_volume) {
              updateSceneField({ music_volume: volume });
            }
          }}
          onKeyUp={() => {
            if (volume !== scene.music_volume) {
              updateSceneField({ music_volume: volume });
            }
          }}
        />
      </label>

      <label className="top-control top-control--avatar-size">
        <span>Аватары {avatarSize}px</span>
        <input
          aria-label={`Размер аватаров ${avatarSize}px`}
          type="range"
          min={80}
          max={600}
          step={10}
          value={avatarSize}
          disabled={updateScene.isPending || finalizing}
          onChange={(event) => setAvatarSize(Number(event.target.value))}
          onPointerUp={() => {
            if (avatarSize !== scene.avatar_size) {
              updateSceneField({ avatar_size: avatarSize });
            }
          }}
          onKeyUp={() => {
            if (avatarSize !== scene.avatar_size) {
              updateSceneField({ avatar_size: avatarSize });
            }
          }}
        />
      </label>

      <div className="top-control top-control--audience">
        <span>Код зрителя</span>
        <strong>{spectatorCode ?? "—"}</strong>
      </div>

      <div className="top-event-control">
        {snapshot.active_event ? (
          <EventFinalization
            campaignId={campaignId}
            snapshot={snapshot}
            onChanged={onChanged}
          />
        ) : (
          <button
            className="button"
            type="button"
            disabled={
              visibleStates.length === 0 || startEvent.isPending
            }
            onClick={() => startEvent.mutate()}
          >
            {startEvent.isPending ? "Запускаем…" : "Запустить событие"}
          </button>
        )}
      </div>

      {error && (
        <div className="gm-top-controls__error">
          <ErrorNotice error={error} />
        </div>
      )}
    </div>
  );
}

function categoryLabel(category: CharacterGM["kind"]) {
  return {
    player: "Игрок",
    npc: "NPC",
    enemy: "Враг",
  }[category];
}
