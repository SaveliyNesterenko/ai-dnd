interface ErrorNoticeProps {
  error: unknown;
  title?: string;
}

export function ErrorNotice({ error, title = "Не удалось выполнить действие" }: ErrorNoticeProps) {
  const message = error instanceof Error ? error.message : "Неизвестная ошибка.";
  return (
    <div className="notice notice--error" role="alert">
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}
