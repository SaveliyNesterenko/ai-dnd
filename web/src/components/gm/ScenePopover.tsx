import { useMutation } from "@tanstack/react-query";
import { useState, type RefObject } from "react";

import { api } from "../../api/client";
import type { GameStateSnapshot } from "../../api/types";
import { useToast } from "../../hooks/useToast";
import { describeError } from "../../utils/errors";
import { Popover } from "../ui/Popover";
import { PlayGlyph, StopGlyph } from "./icons";

export function ScenePopover({
  anchorRef,
  open,
  onClose,
  campaignId,
  scene,
  locked,
  onChanged,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  campaignId: string;
  scene: GameStateSnapshot["scene"];
  locked: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [volume, setVolume] = useState(scene.music_volume);
  const [avatarSize, setAvatarSize] = useState(scene.avatar_size);

  const updateScene = useMutation({
    mutationFn: (input: Parameters<typeof api.updateScene>[1]) =>
      api.updateScene(campaignId, input),
    onSuccess: onChanged,
    onError: (error) =>
      toast.push({
        tone: "error",
        title: "Сцена не обновилась",
        description: describeError(error),
      }),
  });
  const disabled = locked || updateScene.isPending;

  const patch = (input: Omit<Parameters<typeof api.updateScene>[1], "base_revision">) =>
    updateScene.mutate({ ...input, base_revision: scene.revision });

  return (
    <Popover anchorRef={anchorRef} open={open} onClose={onClose} label="Настройки сцены">
      <p className="popover__title">Сцена</p>

      <label className="popover__field">
        <span>Карта</span>
        <select
          value={scene.location_id ?? ""}
          disabled={disabled}
          onChange={(event) => patch({ location_id: event.target.value })}
        >
          {scene.locations.length === 0 && <option value="">Нет карт</option>}
          {scene.locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>

      <label className="popover__field">
        <span>Музыка</span>
        <div className="popover__music">
          <select
            value={scene.music_track_id ?? ""}
            disabled={disabled}
            onChange={(event) => patch({ music_track_id: event.target.value })}
          >
            {scene.music_tracks.length === 0 && <option value="">Нет музыки</option>}
            {scene.music_tracks.map((track) => (
              <option key={track.id} value={track.id}>
                {track.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="mini-button"
            aria-label="Включить музыку"
            title="Включить"
            disabled={!scene.music_track_id || scene.music_is_playing || disabled}
            onClick={() => patch({ music_is_playing: true })}
          >
            <PlayGlyph size={12} />
          </button>
          <button
            type="button"
            className="mini-button"
            aria-label="Остановить музыку"
            title="Остановить"
            disabled={!scene.music_is_playing || disabled}
            onClick={() => patch({ music_is_playing: false })}
          >
            <StopGlyph size={12} />
          </button>
        </div>
      </label>

      <label className="popover__field">
        <span>Громкость · {volume}%</span>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          disabled={disabled}
          onChange={(event) => setVolume(Number(event.target.value))}
          onPointerUp={() => volume !== scene.music_volume && patch({ music_volume: volume })}
          onKeyUp={() => volume !== scene.music_volume && patch({ music_volume: volume })}
        />
      </label>

      <hr className="popover__rule" />

      <label className="popover__field">
        <span>Размер аватаров · {avatarSize}px</span>
        <input
          type="range"
          min={80}
          max={600}
          step={10}
          value={avatarSize}
          disabled={disabled}
          onChange={(event) => setAvatarSize(Number(event.target.value))}
          onPointerUp={() => avatarSize !== scene.avatar_size && patch({ avatar_size: avatarSize })}
          onKeyUp={() => avatarSize !== scene.avatar_size && patch({ avatar_size: avatarSize })}
        />
      </label>
      {/* Слайдер без обратной связи заставляет угадывать: полоски показывают
          масштаб относительно предельных 600px. */}
      <div className="popover__scale-preview" aria-hidden="true">
        <i style={{ height: `${(avatarSize / 600) * 100}%` }} />
        <i style={{ height: `${(avatarSize / 600) * 82}%` }} />
        <span>превью масштаба</span>
      </div>
    </Popover>
  );
}
