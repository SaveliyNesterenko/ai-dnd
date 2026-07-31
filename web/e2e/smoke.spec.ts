import { expect, test } from "@playwright/test";
import { type ChildProcess, spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

let backend: ChildProcess;
const runtimeDirectory = resolve(".playwright-runtime");

test.beforeAll(async () => {
  await rm(runtimeDirectory, { force: true, recursive: true });
  const executable =
    process.platform === "win32"
      ? resolve("../.venv/Scripts/python.exe")
      : resolve("../.venv/bin/python");
  backend = spawn(
    executable,
    ["-c", "from ai_dnd.cli import main; main()", "serve", "--port", "8765"],
    {
      cwd: resolve(".."),
      env: {
        ...process.env,
        AI_DND_DATA_DIR: runtimeDirectory,
        AI_DND_ENVIRONMENT: "test",
        // Сценарий проверяет поведение консоли без внешних моделей. Иначе тест
        // зависит от того, лежит ли у разработчика рабочий ключ в .env:
        // Наблюдатель отвечает по-настоящему, и ветка ручного ввода не
        // показывается. Переменные окружения перекрывают .env.
        AI_DND_OPENAI_API_KEY: "",
        AI_DND_STT_API_KEY: "",
      },
      stdio: "ignore",
    },
  );

  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:8765/api/v1/health/ready");
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("AI-DND test server did not become ready.");
});

test.afterAll(async () => {
  if (!backend || backend.exitCode !== null) return;
  backend.kill();
  await new Promise<void>((done) => {
    backend.once("exit", () => done());
    setTimeout(() => {
      if (backend.exitCode === null) backend.kill("SIGKILL");
      done();
    }, 3_000);
  });
});

test("spectator route offers a protected join flow", async ({ page }) => {
  await page.goto("spectator");
  await expect(page.getByRole("heading", { name: "Подключение к кампании" })).toBeVisible();
  await expect(page.getByLabel("Код зрителя")).toBeVisible();
});

test("GM turn is applied and reaches the spectator projection", async ({ page, browser }) => {
  test.setTimeout(60_000);
  const security = JSON.parse(
    await readFile(resolve(runtimeDirectory, "security.json"), "utf8"),
  ) as { bootstrap_token: string; spectator_code: string };
  await page.goto(`/api/v1/auth/gm/bootstrap?token=${security.bootstrap_token}`);
  const campaignChip = page.getByRole("button", { name: /^Кампания:/ });
  await expect(campaignChip).toContainText("The Clockwork Crossroads");

  // Состав сцены меняется переключателями в поповере «Персонажи».
  const charactersChip = page.getByRole("button", { name: /^Персонажи на сцене:/ });
  await expect(page.locator(".gm-character-card")).toHaveCount(2);
  await charactersChip.click();
  const ariaSwitch = page.getByRole("switch", { name: /Aria Vale/ });
  await ariaSwitch.click();
  await expect(page.locator(".gm-character-card")).toHaveCount(1);
  await ariaSwitch.click();
  await expect(page.locator(".gm-character-card")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "HP / MP" }).first().click();
  await page.getByLabel("HP, текущее").fill("27");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  // Карточка возвращается на лицевую сторону, а сохранённое значение видно
  // в редакторе HP/MP: с лицевой стороны показатели убраны.
  await expect(page.locator(".gm-character-card--flipped")).toHaveCount(0);
  await page.getByRole("button", { name: "HP / MP" }).first().click();
  await expect(page.getByLabel("HP, текущее")).toHaveValue("27");
  await page.locator(".gm-character-card--flipped .gm-character-card__hint").click();
  await expect(page.locator(".gm-character-card--flipped")).toHaveCount(0);

  await page.getByRole("button", { name: "Запустить событие" }).click();
  await page.getByRole("button", { name: "Написать ход вручную" }).click();
  await expect(page.getByLabel("Публичное действие")).toBeVisible();
  const spectatorContext = await browser.newContext({
    baseURL: "http://127.0.0.1:8765/",
  });
  const spectator = await spectatorContext.newPage();
  await spectator.goto("/spectator");
  await spectator.getByLabel("Код зрителя").fill(security.spectator_code);
  await spectator.getByRole("button", { name: "Войти в сцену" }).click();
  await expect(spectator.locator(".spectator-avatar")).toHaveCount(2);

  const action = "<img src=x onerror=alert(1)> Aria studies the mechanism.";
  await page.getByLabel("Публичное действие").fill(action);
  const thought = "Aria notices a pattern visible to the audience.";
  await page.getByLabel("Мысль модели").fill(thought);
  await page.getByRole("button", { name: "Отправить с броском d20" }).click();
  // Мысль у зрителя показывается недолго и сменяется репликой, поэтому её
  // проверяем сразу после публикации — до обращения к логу ГМ.
  await expect(spectator.locator(".speech-bubble.thought")).toBeVisible();
  await expect(spectator.getByText(thought, { exact: true })).toBeVisible();
  await expect(page.getByText(action, { exact: true })).toBeVisible();
  await expect(spectator.getByText(action, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(spectator.locator(".speech-bubble.action")).toBeVisible();
  await expect(spectator.getByText(thought, { exact: true })).toBeHidden();

  // Предложение Наблюдателя: строки изменений вместо сырого JSON, применение
  // возвращает панель к исходному состоянию.
  await page.getByRole("button", { name: "Создать вручную" }).click();
  const applyButton = page.getByRole("button", { name: /^Применить \(/ });
  await expect(applyButton).toBeVisible();
  await expect(page.getByLabel("GM Brief")).toHaveValue("Ручное предложение GM.");
  await applyButton.click();
  await expect(applyButton).toBeHidden();
  await expect(page.getByRole("button", { name: "Создать вручную" })).toBeVisible();

  await page.getByRole("button", { name: "Завершить событие" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Событие завершается" })
      .getByRole("heading", { name: "Событие завершается" }),
  ).toBeVisible();
  await expect(page.getByText("Лог сохранён")).toBeVisible();
  await expect(
    page.getByText("Архивариус или модель игрока сейчас недоступны."),
  ).toBeVisible();
  await expect(page.getByText(action, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Ввести результат вручную" }).click();
  await page
    .getByLabel("Общая хроника участников")
    .fill("Aria and Bram documented the clockwork mechanism.");
  const recollections = page.locator(".finalization__player-note textarea");
  await expect(recollections).toHaveCount(2);
  await recollections.nth(0).fill("I remember the clockwork mechanism.");
  await recollections.nth(1).fill("I remember guarding the mechanism.");
  await page.getByRole("button", { name: "Сохранить и завершить" }).click();
  await expect(page.getByRole("button", { name: "Запустить событие" })).toBeVisible();
  await spectatorContext.close();
});
