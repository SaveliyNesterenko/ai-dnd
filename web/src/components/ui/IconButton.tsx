import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Доступное имя обязательно: внутри только значок. */
  label: string;
  icon: ReactNode;
  tone?: "default" | "danger";
}

export function IconButton({
  label,
  icon,
  tone = "default",
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={rest.type ?? "button"}
      className={`icon-button${tone === "danger" ? " icon-button--danger" : ""}${
        className ? ` ${className}` : ""
      }`}
      aria-label={label}
      title={rest.title ?? label}
    >
      {icon}
    </button>
  );
}
