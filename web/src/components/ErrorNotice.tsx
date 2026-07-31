import { describeError } from "../utils/errors";

interface ErrorNoticeProps {
  error: unknown;
  title?: string;
}

export function ErrorNotice({ error, title = "Не удалось выполнить действие" }: ErrorNoticeProps) {
  return (
    <div className="notice notice--error" role="alert">
      <strong>{title}</strong>
      <span>{describeError(error)}</span>
    </div>
  );
}
