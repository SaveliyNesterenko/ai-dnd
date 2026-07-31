import type { CharacterGM, ObserverOperation } from "../api/types";

/**
 * Предложение Наблюдателя приходит типизированным набором операций. Раньше ГМ
 * правил их в сыром JSON прямо посреди сессии; здесь операция превращается в
 * строку, которую можно прочитать и поправить.
 */

const OPERATION_KINDS = [
  "set_resource",
  "set_attribute",
  "add_inventory_item",
  "update_inventory_item",
  "remove_inventory_item",
  "adjust_inventory_item",
  "add_status_effect",
  "remove_status_effect",
] as const;

export type OperationKind = "resource" | "attribute" | "inventory" | "effect" | "unknown";

export interface OperationSummary {
  characterId: string | null;
  kind: OperationKind;
  /** Что меняется: «HP», «Ловкость», «Инвентарь», «Эффект». */
  label: string;
  /** Основная фраза изменения. */
  text: string;
  /** Название предмета или эффекта — выносится в отдельный значок. */
  tag?: string;
  /** Знаковое изменение, если его можно посчитать. */
  delta?: number;
  /**
   * Число, которое правится прямо в строке. `update` возвращает новую
   * операцию, поэтому вложенность (например, количество внутри предмета)
   * остаётся заботой этого модуля, а не компонента.
   */
  editable?: { value: number; update: (next: number) => ObserverOperation };
}

/** Отсеивает всё, что не похоже на типизированную операцию. */
export function isObserverOperation(value: unknown): value is ObserverOperation {
  if (typeof value !== "object" || value === null) return false;
  const op = (value as { op?: unknown }).op;
  return (
    typeof op === "string" &&
    (OPERATION_KINDS as readonly string[]).includes(op) &&
    typeof (value as { character_id?: unknown }).character_id === "string"
  );
}

/**
 * Разбирает массив из предложения. Нераспознанные элементы сохраняются как
 * есть: молча терять изменение, которое предложил Наблюдатель, нельзя.
 */
export function parseOperations(value: unknown): ObserverOperation[] {
  if (!Array.isArray(value)) {
    throw new Error("Operations должны быть JSON-массивом.");
  }
  return value as ObserverOperation[];
}

const RESOURCE_LABEL = { hp: "HP", mp: "MP" } as const;

export function describeOperation(
  operation: ObserverOperation,
  character: CharacterGM | undefined,
): OperationSummary {
  if (!isObserverOperation(operation)) {
    return {
      characterId: null,
      kind: "unknown",
      label: "Операция",
      text: "неизвестный тип — правьте в JSON",
      tag: JSON.stringify(operation),
    };
  }

  switch (operation.op) {
    case "set_resource": {
      const before =
        character &&
        (operation.resource === "hp" ? character.hp_current : character.mp_current);
      const maximum =
        operation.maximum ??
        (character && (operation.resource === "hp" ? character.hp_max : character.mp_max));
      return {
        characterId: operation.character_id,
        kind: "resource",
        label: RESOURCE_LABEL[operation.resource],
        text:
          before === undefined
            ? `→ ${operation.current}${maximum === undefined ? "" : ` / ${maximum}`}`
            : `${before} → ${operation.current}${maximum === undefined ? "" : ` / ${maximum}`}`,
        delta: before === undefined ? undefined : operation.current - before,
        editable: {
          value: operation.current,
          update: (next) => ({ ...operation, current: next }),
        },
      };
    }

    case "set_attribute": {
      const before = character?.attributes[operation.attribute];
      return {
        characterId: operation.character_id,
        kind: "attribute",
        label: operation.attribute,
        text: before === undefined ? `→ ${operation.value}` : `${before} → ${operation.value}`,
        delta: before === undefined ? undefined : operation.value - before,
        editable: {
          value: operation.value,
          update: (next) => ({ ...operation, value: next }),
        },
      };
    }

    case "add_inventory_item":
      return {
        characterId: operation.character_id,
        kind: "inventory",
        label: "Инвентарь",
        text: "добавить",
        tag: operation.item.name,
        // Дельта тут совпала бы с редактируемым количеством — не дублируем.
        editable: {
          value: operation.item.quantity ?? 1,
          update: (next) => ({ ...operation, item: { ...operation.item, quantity: next } }),
        },
      };

    case "adjust_inventory_item":
      return {
        characterId: operation.character_id,
        kind: "inventory",
        label: "Инвентарь",
        text: "количество",
        tag: itemLabel(operation.name, operation.item_id),
        delta: operation.quantity_delta,
        editable: {
          value: operation.quantity_delta,
          update: (next) => ({ ...operation, quantity_delta: next }),
        },
      };

    case "update_inventory_item":
      return {
        characterId: operation.character_id,
        kind: "inventory",
        label: "Инвентарь",
        text: operation.quantity === null || operation.quantity === undefined ? "изменить" : "количество",
        tag: itemLabel(operation.item_name ?? operation.name, operation.item_id),
        editable:
          operation.quantity === null || operation.quantity === undefined
            ? undefined
            : {
                value: operation.quantity,
                update: (next) => ({ ...operation, quantity: next }),
              },
      };

    case "remove_inventory_item":
      return {
        characterId: operation.character_id,
        kind: "inventory",
        label: "Инвентарь",
        text: "убрать",
        tag: itemLabel(operation.name, operation.item_id),
      };

    case "add_status_effect":
      return {
        characterId: operation.character_id,
        kind: "effect",
        label: "Эффект",
        text: "наложить",
        tag: operation.name,
      };

    case "remove_status_effect":
      return {
        characterId: operation.character_id,
        kind: "effect",
        label: "Эффект",
        text: "снять",
        tag: itemLabel(operation.name, operation.status_effect_id),
      };
  }
}

function itemLabel(name: string | null | undefined, id: string | null | undefined) {
  return name ?? (id ? `#${id}` : "без названия");
}
