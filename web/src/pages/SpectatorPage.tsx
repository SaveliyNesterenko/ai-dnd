import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import type { RealtimeEvent } from "../api/types";
import { CharacterCard } from "../components/CharacterCard";
import { CharacterDetailsModal } from "../components/CharacterDetailsModal";
import { DraggableSpectatorAvatar } from "../components/DraggableSpectatorAvatar";
import type { SpectatorAvatarPosition } from "../components/DraggableSpectatorAvatar";
import { ErrorNotice } from "../components/ErrorNotice";
import { SpeechBubble } from "../components/SpeechBubble";
import { useRealtime } from "../hooks/useRealtime";
import { useSpeechPlayback } from "../hooks/useSpeechPlayback";

export default function SpectatorPage() {
  const queryClient = useQueryClient();
  const [draftCode, setDraftCode] = useState("");
  const [joinCode, setJoinCode] = useState(() => sessionStorage.getItem("ai-dnd-join-code") ?? "");
  const [positionError, setPositionError] = useState<unknown>(null);
  const [openCharacterId, setOpenCharacterId] = useState<string | null>(null);
  const gmSession = useQuery({
    queryKey: ["gm-session"],
    queryFn: api.gmSession,
    retry: false,
  });
  const hasGmAccess = gmSession.isSuccess;
  const campaigns = useQuery({ queryKey: ["campaigns"], queryFn: api.campaigns });
  const campaignId =
    campaigns.data?.find((campaign) => campaign.is_active)?.id ?? campaigns.data?.[0]?.id;
  const {
    activeCue,
    diceRoll,
    enqueueRealtimeEvent,
    completeActiveCue,
  } = useSpeechPlayback(campaignId);
  const snapshot = useQuery({
    queryKey: ["public-snapshot", campaignId, joinCode],
    queryFn: () => api.publicSnapshot(campaignId!, joinCode),
    enabled: Boolean(campaignId && (joinCode || hasGmAccess)),
    retry: false,
  });
  const handleRealtime = useCallback(
    (event: RealtimeEvent) => {
      enqueueRealtimeEvent(event);
      void queryClient.invalidateQueries({ queryKey: ["public-snapshot", campaignId, joinCode] });
    },
    [campaignId, enqueueRealtimeEvent, joinCode, queryClient],
  );
  useRealtime(
    snapshot.data ? campaignId : undefined,
    snapshot.data?.last_sequence ?? 0,
    joinCode || undefined,
    handleRealtime,
  );
  const persistAvatarPosition = useCallback(
    async (
      characterId: string,
      baseRevision: number,
      position: SpectatorAvatarPosition,
    ) => {
      if (!campaignId || !hasGmAccess) {
        throw new Error("GM authentication is required.");
      }
      setPositionError(null);
      try {
        await api.updateSceneCharacter(campaignId, characterId, {
          x: position.x,
          y: position.y,
          base_revision: baseRevision,
        });
        await queryClient.invalidateQueries({
          queryKey: ["public-snapshot", campaignId, joinCode],
        });
      } catch (error) {
        setPositionError(error);
        await queryClient.invalidateQueries({
          queryKey: ["public-snapshot", campaignId, joinCode],
        });
        throw error;
      }
    },
    [campaignId, hasGmAccess, joinCode, queryClient],
  );

  if (gmSession.isPending) {
    return <main className="center-screen">Проверка доступа к сцене…</main>;
  }
  if (!joinCode && !hasGmAccess) {
    return (
      <main className="join-screen">
        <div className="join-card">
          <span className="eyebrow">Spectator View</span>
          <h1>Подключение к кампании</h1>
          <p>Введите шестизначный код, который отображается в GM Console.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const normalized = draftCode.trim();
              if (!/^\d{6}$/.test(normalized)) return;
              sessionStorage.setItem("ai-dnd-join-code", normalized);
              setJoinCode(normalized);
            }}
          >
            <label htmlFor="join-code">Код зрителя</label>
            <input
              id="join-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={draftCode}
              onChange={(event) => setDraftCode(event.target.value)}
            />
            <button className="button" type="submit">
              Войти в сцену
            </button>
          </form>
        </div>
      </main>
    );
  }
  if (campaigns.isPending || snapshot.isPending) {
    return <main className="center-screen">Подключение к сцене…</main>;
  }
  if (campaigns.error || snapshot.error || !snapshot.data) {
    return (
      <main className="join-screen">
        <div className="join-card">
          <ErrorNotice error={campaigns.error ?? snapshot.error} title="Подключение отклонено" />
          <button
            className="button button--quiet"
            type="button"
            onClick={() => {
              sessionStorage.removeItem("ai-dnd-join-code");
              setJoinCode("");
            }}
          >
            Ввести другой код
          </button>
        </div>
      </main>
    );
  }

  const normalizedLocation = snapshot.data.scene.locations.find(
    (item) => item.id === snapshot.data.scene.location_id,
  );
  const legacyLocation =
    typeof snapshot.data.world_state.location === "object" &&
    snapshot.data.world_state.location !== null
      ? (snapshot.data.world_state.location as { image_url?: string; name?: string })
      : undefined;
  const location = normalizedLocation ?? legacyLocation;
  const music = snapshot.data.scene.music_tracks.find(
    (item) => item.id === snapshot.data.scene.music_track_id,
  );
  const activeCharacters = snapshot.data.characters.filter((character) => character.is_active);
  const openCharacter = activeCharacters.find((character) => character.id === openCharacterId);

  return (
    <main
      className="spectator"
      style={location?.image_url ? { backgroundImage: `url("${location.image_url}")` } : undefined}
    >
      {positionError ? (
        <div className="spectator__position-error">
          <ErrorNotice error={positionError} title="Не удалось переместить персонажа" />
        </div>
      ) : null}
      <SceneMusic
        url={music?.audio_url}
        isPlaying={snapshot.data.scene.music_is_playing}
        volume={snapshot.data.scene.music_volume}
      />
      <section className="spectator__characters" aria-label="Активные персонажи">
        {activeCharacters.map((character) => (
          <CharacterCard
            key={character.id}
            character={character}
            onOpen={(selected) => setOpenCharacterId(selected.id)}
          />
        ))}
      </section>

      <section className="spectator__avatars" aria-label="Персонажи на сцене">
        {snapshot.data.scene.characters
          .filter((state) => state.is_visible)
          .map((state) => {
            const character = snapshot.data.characters.find(
              (item) => item.id === state.character_id,
            );
            if (!character) return null;
            const imageUrl =
              character.avatar_url ?? character.portrait_url ?? character.sprite_url;
            const isSpeaking = activeCue?.characterId === character.id;
            const avatarSize = snapshot.data.scene.avatar_size * (state.scale / 100);
            return (
              <DraggableSpectatorAvatar
                canDrag={hasGmAccess}
                initialPosition={{ x: state.x, y: state.y }}
                isSpeaking={isSpeaking}
                key={character.id}
                name={character.name}
                onPositionChange={(position) =>
                  persistAvatarPosition(character.id, state.revision, position)
                }
                width={avatarSize}
                zIndex={isSpeaking ? 1000 : state.order + 1}
              >
                {isSpeaking && activeCue ? (
                  <SpeechBubble cue={activeCue} onComplete={completeActiveCue} />
                ) : null}
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={character.name}
                    draggable={false}
                    style={{ transform: state.flip_x ? "scaleX(-1)" : undefined }}
                  />
                ) : null}
              </DraggableSpectatorAvatar>
            );
          })}
      </section>

      <section className="spectator__stage">
        {diceRoll !== null ? (
          <div
            className="spectator-dice-roll"
            role="status"
            aria-label={`Результат броска: ${diceRoll}`}
          >
            {diceRoll}
          </div>
        ) : null}
      </section>

      {openCharacter && (
        <CharacterDetailsModal
          character={openCharacter}
          onClose={() => setOpenCharacterId(null)}
        />
      )}
    </main>
  );
}

function SceneMusic({
  url,
  isPlaying,
  volume,
}: {
  url: string | undefined;
  isPlaying: boolean;
  volume: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume / 100;
    if (!url || !isPlaying) {
      audio.pause();
      return;
    }
    void audio.play().then(
      () => setLocked(false),
      () => setLocked(true),
    );
  }, [isPlaying, url, volume]);

  if (!url) return null;
  return (
    <div className="scene-music">
      <audio ref={audioRef} src={url} loop preload="auto" />
      {locked && isPlaying && (
        <button
          className="button"
          type="button"
          onClick={() => {
            void audioRef.current?.play().then(() => setLocked(false));
          }}
        >
          Включить звук
        </button>
      )}
    </div>
  );
}
