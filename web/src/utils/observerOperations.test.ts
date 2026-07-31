import { describe, expect, it } from "vitest";

import type { CharacterGM, ObserverOperation } from "../api/types";
import { describeOperation, isObserverOperation, parseOperations } from "./observerOperations";

const character = {
  id: "gareth",
  name: "Гарет из Дола",
  kind: "player",
  hp_current: 24,
  hp_max: 34,
  mp_current: 4,
  mp_max: 10,
  attributes: { Сила: 14, Ловкость: 11 },
} as unknown as CharacterGM;

describe("describeOperation", () => {
  it("считает дельту ресурса от текущего состояния персонажа", () => {
    const summary = describeOperation(
      { op: "set_resource", character_id: "gareth", resource: "hp", current: 17 },
      character,
    );

    expect(summary).toMatchObject({
      kind: "resource",
      label: "HP",
      text: "24 → 17 / 34",
      delta: -7,
    });
  });

  it("обходится без дельты, когда персонаж неизвестен", () => {
    const summary = describeOperation(
      { op: "set_resource", character_id: "ghost", resource: "mp", current: 3 },
      undefined,
    );

    expect(summary.text).toBe("→ 3");
    expect(summary.delta).toBeUndefined();
  });

  it("берёт максимум из операции, если он задан явно", () => {
    const summary = describeOperation(
      { op: "set_resource", character_id: "gareth", resource: "hp", current: 30, maximum: 40 },
      character,
    );

    expect(summary.text).toBe("24 → 30 / 40");
    expect(summary.delta).toBe(6);
  });

  it("описывает характеристику с её прежним значением", () => {
    const summary = describeOperation(
      { op: "set_attribute", character_id: "gareth", attribute: "Сила", value: 16 },
      character,
    );

    expect(summary).toMatchObject({ kind: "attribute", label: "Сила", text: "14 → 16", delta: 2 });
  });

  it("описывает все виды операций с инвентарём", () => {
    const add = describeOperation(
      {
        op: "add_inventory_item",
        character_id: "gareth",
        item: { name: "Обломок болта", quantity: 2, description: "" },
      },
      character,
    );
    expect(add).toMatchObject({ kind: "inventory", text: "добавить", tag: "Обломок болта" });
    expect(add.delta).toBeUndefined();
    expect(add.editable?.value).toBe(2);

    const adjust = describeOperation(
      { op: "adjust_inventory_item", character_id: "gareth", name: "Стрелы", quantity_delta: -3 },
      character,
    );
    expect(adjust).toMatchObject({ text: "количество", tag: "Стрелы", delta: -3 });

    const remove = describeOperation(
      { op: "remove_inventory_item", character_id: "gareth", item_id: "it-9" },
      character,
    );
    expect(remove).toMatchObject({ text: "убрать", tag: "#it-9" });
    expect(remove.editable).toBeUndefined();
  });

  it("описывает статусные эффекты", () => {
    expect(
      describeOperation(
        { op: "add_status_effect", character_id: "mira", name: "Ослеплена" },
        undefined,
      ),
    ).toMatchObject({ kind: "effect", text: "наложить", tag: "Ослеплена" });

    expect(
      describeOperation(
        { op: "remove_status_effect", character_id: "mira", name: "Ослеплена" },
        undefined,
      ),
    ).toMatchObject({ text: "снять", tag: "Ослеплена" });
  });

  it("правит вложенное количество, не ломая остальную операцию", () => {
    const operation: ObserverOperation = {
      op: "add_inventory_item",
      character_id: "gareth",
      item: { name: "Зелье", quantity: 1, description: "лечит 2d4" },
    };

    const updated = describeOperation(operation, character).editable!.update(5);

    expect(updated).toEqual({
      op: "add_inventory_item",
      character_id: "gareth",
      item: { name: "Зелье", quantity: 5, description: "лечит 2d4" },
    });
  });

  it("не теряет операцию неизвестного типа", () => {
    const summary = describeOperation(
      { op: "teleport", character_id: "gareth" } as unknown as ObserverOperation,
      character,
    );

    expect(summary.kind).toBe("unknown");
    expect(summary.tag).toContain("teleport");
  });
});

describe("parseOperations", () => {
  it("переживает round-trip через JSON без потерь", () => {
    const operations: ObserverOperation[] = [
      { op: "set_resource", character_id: "gareth", resource: "hp", current: 17 },
      { op: "add_status_effect", character_id: "mira", name: "Ослеплена" },
    ];

    expect(parseOperations(JSON.parse(JSON.stringify(operations)))).toEqual(operations);
  });

  it("отвергает не массив", () => {
    expect(() => parseOperations({ op: "set_resource" })).toThrow("JSON-массивом");
  });
});

describe("isObserverOperation", () => {
  it("отличает типизированную операцию от постороннего объекта", () => {
    expect(
      isObserverOperation({ op: "set_attribute", character_id: "x", attribute: "Сила", value: 1 }),
    ).toBe(true);
    expect(isObserverOperation({ op: "set_attribute" })).toBe(false);
    expect(isObserverOperation({ character_id: "x" })).toBe(false);
    expect(isObserverOperation(null)).toBe(false);
  });
});
