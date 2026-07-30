/**
 * Полоса состояния хода. Показывает, на каком шаге цикла находится ГМ и что
 * система делает прямо сейчас: долгие задачи получают линию прогресса и
 * счётчик секунд вместо задизейбленной кнопки где-то в панели.
 */

import { formatElapsed } from "../../utils/format";

export type TurnStage = 1 | 2 | 3 | 4;

export interface FlowBusy {
  stage: TurnStage;
  label: string;
  elapsedMs: number;
  onCancel?: () => void;
}

const STEPS: { stage: TurnStage; title: string; role: string }[] = [
  { stage: 1, title: "Реплика ГМ", role: "gm" },
  { stage: 2, title: "Ход модели", role: "model" },
  { stage: 3, title: "Наблюдатель", role: "observer" },
  { stage: 4, title: "Применено", role: "archivist" },
];

export function TurnFlowStrip({
  stage,
  busy,
  idle,
}: {
  stage: TurnStage;
  busy?: FlowBusy;
  /** Без активного события цикл не идёт — полоса гаснет целиком. */
  idle: boolean;
}) {
  return (
    <nav
      className={`flow-strip${idle ? " flow-strip--idle" : ""}`}
      aria-label="Состояние хода"
    >
      {STEPS.map((step) => {
        const isBusy = !idle && busy?.stage === step.stage;
        const isActive = !idle && stage === step.stage;
        const isDone = !idle && stage > step.stage;
        return (
          <div
            key={step.stage}
            className={`flow-step flow-step--${step.role}${isActive ? " is-active" : ""}${
              isDone ? " is-done" : ""
            }${isBusy ? " is-busy" : ""}`}
            aria-current={isActive ? "step" : undefined}
          >
            <span className="flow-step__mark" aria-hidden="true">
              {isDone ? "✓" : step.stage}
            </span>
            <span className="flow-step__title">{isBusy ? busy.label : step.title}</span>
            {isBusy && (
              <span className="flow-step__timer mono">{formatElapsed(busy.elapsedMs)}</span>
            )}
            {isBusy && busy.onCancel && (
              <button type="button" className="flow-step__cancel" onClick={busy.onCancel}>
                Отменить
              </button>
            )}
          </div>
        );
      })}
    </nav>
  );
}
