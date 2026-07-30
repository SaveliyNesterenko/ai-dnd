export function formatElapsed(elapsedMs: number) {
  const total = Math.floor(elapsedMs / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function formatClock(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function kindLabel(kind: "player" | "npc" | "enemy") {
  return { player: "Игрок", npc: "NPC", enemy: "Враг" }[kind];
}

/** «12 ходов», «2 хода», «21 ход». */
export function pluralTurns(count: number) {
  const tail = count % 100;
  if (tail > 10 && tail < 20) return "ходов";
  switch (count % 10) {
    case 1:
      return "ход";
    case 2:
    case 3:
    case 4:
      return "хода";
    default:
      return "ходов";
  }
}
