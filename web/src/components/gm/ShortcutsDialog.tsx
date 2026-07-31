import { Dialog } from "../ui/Dialog";

const GROUPS: { title: string; items: { keys: string[]; action: string }[] }[] = [
  {
    title: "Ход",
    items: [
      { keys: ["G"], action: "Сгенерировать ход выбранного персонажа" },
      { keys: ["Ctrl", "Enter"], action: "Опубликовать ход" },
      { keys: ["Shift", "Ctrl", "Enter"], action: "Опубликовать с броском d20" },
      { keys: ["O"], action: "Запустить Наблюдателя" },
    ],
  },
  {
    title: "Голос",
    items: [{ keys: ["R"], action: "Начать или остановить запись" }],
  },
  {
    title: "Сцена",
    items: [
      { keys: ["1", "…", "9"], action: "Выбрать N-го персонажа на сцене" },
      { keys: ["Alt", "\\"], action: "Свернуть или развернуть ленту" },
      { keys: ["?"], action: "Этот свиток" },
      { keys: ["Esc"], action: "Закрыть окно или список" },
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Свиток горячих клавиш" eyebrow="Консоль" size="s" onClose={onClose}>
      <dl className="shortcuts">
        {GROUPS.map((group) => (
          <div className="shortcuts__group" key={group.title}>
            <p className="shortcuts__title">{group.title}</p>
            {group.items.map((item) => (
              <div className="shortcuts__row" key={item.action}>
                <dt>
                  {item.keys.map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </dt>
                <dd>{item.action}</dd>
              </div>
            ))}
          </div>
        ))}
      </dl>
      <p className="shortcuts__note">
        Клавиши молчат, пока курсор стоит в поле ввода, и определяются по позиции
        на клавиатуре — раскладка значения не имеет.
      </p>
    </Dialog>
  );
}
