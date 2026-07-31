import type { ReactNode } from "react";

/** Значки консоли: один стиль, одна толщина штриха, всегда aria-hidden. */
function Glyph({ size = 15, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const ChevronDown = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M6 9l6 6 6-6" />
  </Glyph>
);

export const ChevronUp = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M6 15l6-6 6 6" />
  </Glyph>
);

export const PlayGlyph = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M7 4.8l12 7.2-12 7.2z" />
  </Glyph>
);

export const StopGlyph = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </Glyph>
);

export const ClockGlyph = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Glyph>
);

export const SparkGlyph = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M12 3l2.2 5.3L20 10l-5.8 1.7L12 17l-2.2-5.3L4 10l5.8-1.7z" />
  </Glyph>
);

export const MicGlyph = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <rect x="9" y="2.5" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3.5" />
  </Glyph>
);

export const SendGlyph = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M4 12h15" />
    <path d="M13 6l6 6-6 6" />
  </Glyph>
);

export const DieGlyph = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M12 2.5l8 4.6v9.8l-8 4.6-8-4.6V7.1z" />
    <path d="M12 8.6v6.8" />
  </Glyph>
);

export const RetryGlyph = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
    <path d="M3 21v-5h5" />
  </Glyph>
);

export const TrashGlyph = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M4 7h16" />
    <path d="M9 7V4.6h6V7" />
    <path d="M6.5 7l1 12.4h9L18 7" />
  </Glyph>
);

export const CollapseGlyph = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M4 8h16" />
    <path d="M7 12h10" />
    <path d="M4 16h16" />
  </Glyph>
);

/** Облачко мысли: отличает приватный для контекста блок от публичного. */
export const ThoughtGlyph = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M8.5 4.2a3.6 3.6 0 0 1 6.4 1 3.4 3.4 0 0 1 2.6 5.6A3.6 3.6 0 0 1 14 16.5H9a4 4 0 0 1-.5-8v-.1a3.6 3.6 0 0 1 0-4.2Z" />
    <circle cx="6.5" cy="19.4" r="1.4" />
    <circle cx="3.2" cy="21.8" r="0.8" />
  </Glyph>
);

/** Динамик со звуковыми волнами: реплика озвучена. */
export const SpeakerGlyph = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
    <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />
    <path d="M18 6.7a7.5 7.5 0 0 1 0 10.6" />
  </Glyph>
);

/** Перечёркнутый динамик: реплика ушла к зрителю только текстом. */
export const SpeakerOffGlyph = ({ size }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
    <path d="M16 10l5 4" />
    <path d="M21 10l-5 4" />
  </Glyph>
);

export const KindGlyph = ({
  kind,
  size = 13,
}: {
  kind: "player" | "npc" | "enemy";
  size?: number;
}) => (
  <Glyph size={size}>
    {kind === "player" && <path d="M12 3l7 3v5.5c0 4.4-2.9 7.4-7 8.5-4.1-1.1-7-4.1-7-8.5V6z" />}
    {kind === "npc" && (
      <>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
      </>
    )}
    {kind === "enemy" && (
      <>
        <path d="M12 3.4c-3.9 0-6.6 2.6-6.6 6.2 0 1.9.8 3.4 2.1 4.4v2c0 .8.7 1.5 1.5 1.5h6c.8 0 1.5-.7 1.5-1.5v-2c1.3-1 2.1-2.5 2.1-4.4 0-3.6-2.7-6.2-6.6-6.2Z" />
        <circle cx="9.6" cy="10" r="1.1" />
        <circle cx="14.4" cy="10" r="1.1" />
      </>
    )}
  </Glyph>
);
