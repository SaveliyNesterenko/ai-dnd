interface ResourceBarProps {
  label: string;
  current: number;
  maximum: number;
  tone: "health" | "mana";
}

export function ResourceBar({ label, current, maximum, tone }: ResourceBarProps) {
  const percentage = maximum > 0 ? Math.max(0, Math.min(100, (current / maximum) * 100)) : 0;
  return (
    <div className="resource" aria-label={`${label}: ${current} из ${maximum}`}>
      <div className="resource__header">
        <span>{label}</span>
        <span>
          {current} / {maximum}
        </span>
      </div>
      <div className="resource__track" aria-hidden="true">
        <div
          className={`resource__fill resource__fill--${tone}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
