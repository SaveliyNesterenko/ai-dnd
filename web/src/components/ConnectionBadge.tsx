interface ConnectionBadgeProps {
  state: "idle" | "connecting" | "connected" | "reconnecting";
}

const labels = {
  idle: "Не подключено",
  connecting: "Подключение",
  connected: "В эфире",
  reconnecting: "Восстановление",
};

export function ConnectionBadge({ state }: ConnectionBadgeProps) {
  return (
    <span className={`connection connection--${state}`} role="status">
      <span aria-hidden="true" />
      {labels[state]}
    </span>
  );
}
