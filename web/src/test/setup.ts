import "@testing-library/jest-dom/vitest";

// jsdom не реализует ResizeObserver, который используется для замера аватаров.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
