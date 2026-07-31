import { useEffect, useRef } from "react";

/**
 * Живая сессия — это скорость, поэтому клавиши работают из любой панели.
 *
 * Сопоставление идёт по `event.code`, а не по `key`: у ГМ-а может быть включена
 * русская раскладка, и тогда «G» приходит как «п».
 */
export interface Hotkey {
  /** Физическая клавиша: «KeyG», «Digit1», «Backslash», «Slash». */
  code: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: () => void;
  /** Выключенная связка не перехватывает клавишу и не мешает другим. */
  enabled?: boolean;
  /** По умолчанию связка молчит, пока курсор в поле ввода. */
  allowInField?: boolean;
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function useHotkeys(hotkeys: Hotkey[]) {
  const ref = useRef(hotkeys);
  useEffect(() => {
    ref.current = hotkeys;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const typing = isTypingTarget(event.target);
      for (const hotkey of ref.current) {
        if (hotkey.enabled === false) continue;
        if (hotkey.code !== event.code) continue;
        if (Boolean(hotkey.ctrl) !== (event.ctrlKey || event.metaKey)) continue;
        if (Boolean(hotkey.shift) !== event.shiftKey) continue;
        if (Boolean(hotkey.alt) !== event.altKey) continue;
        if (typing && !hotkey.allowInField) continue;
        event.preventDefault();
        hotkey.handler();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
