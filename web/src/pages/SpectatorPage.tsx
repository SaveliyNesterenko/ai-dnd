import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { api } from "../api/client";
import { CharacterCard } from "../components/CharacterCard";
import { ConnectionBadge } from "../components/ConnectionBadge";
import { ErrorNotice } from "../components/ErrorNotice";
import { useRealtime } from "../hooks/useRealtime";

export default function SpectatorPage() {
  const queryClient = useQueryClient();
  const [draftCode, setDraftCode] = useState("");
  const [joinCode, setJoinCode] = useState(() => sessionStorage.getItem("ai-dnd-join-code") ?? "");
  const campaigns = useQuery({ queryKey: ["campaigns"], queryFn: api.campaigns });
  const campaignId = campaigns.data?.[0]?.id;
  const snapshot = useQuery({
    queryKey: ["public-snapshot", campaignId, joinCode],
    queryFn: () => api.publicSnapshot(campaignId!, joinCode),
    enabled: Boolean(campaignId && joinCode),
    retry: false,
  });
  const handleRealtime = useCallback(
    () => {
      void queryClient.invalidateQueries({ queryKey: ["public-snapshot", campaignId, joinCode] });
    },
    [campaignId, joinCode, queryClient],
  );
  const connection = useRealtime(
    snapshot.data ? campaignId : undefined,
    snapshot.data?.last_sequence ?? 0,
    joinCode || undefined,
    handleRealtime,
  );

  if (!joinCode) {
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

  const rawLocation = snapshot.data.world_state.location;
  const location =
    typeof rawLocation === "object" && rawLocation !== null
      ? (rawLocation as { image_url?: string; name?: string })
      : undefined;
  const activeCharacters = snapshot.data.characters.filter((character) => character.is_active);
  const turns = snapshot.data.active_event?.turns ?? [];
  const lastTurn = turns.at(-1);

  return (
    <main
      className="spectator"
      style={location?.image_url ? { backgroundImage: `url("${location.image_url}")` } : undefined}
    >
      <div className="spectator__veil" />
      <header className="spectator__header">
        <div>
          <span className="eyebrow">Сейчас в игре</span>
          <h1>{location?.name ?? snapshot.data.campaign.name}</h1>
        </div>
        <ConnectionBadge state={connection} />
      </header>

      <section className="spectator__story" aria-live="polite">
        {lastTurn ? (
          <article className="speech-card">
            <span className="speech-card__actor">{lastTurn.actor_name}</span>
            {lastTurn.thought && <p className="speech-card__thought">{lastTurn.thought}</p>}
            <p className="speech-card__action">{lastTurn.action}</p>
            {lastTurn.dice_roll && <span className="die die--large">{lastTurn.dice_roll}</span>}
          </article>
        ) : (
          <div className="speech-card speech-card--waiting">
            <p>Сцена готова. Ожидаем первый ход.</p>
          </div>
        )}
      </section>

      <section className="spectator__characters" aria-label="Активные персонажи">
        {activeCharacters.map((character) => (
          <CharacterCard key={character.id} character={character} compact />
        ))}
      </section>
    </main>
  );
}
