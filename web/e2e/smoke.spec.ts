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
      ? resolve("../.venv/Scripts/ai-dnd.exe")
      : resolve("../.venv/bin/ai-dnd");
  backend = spawn(executable, ["serve"], {
    cwd: resolve(".."),
    env: {
      ...process.env,
      AI_DND_DATA_DIR: runtimeDirectory,
      AI_DND_ENVIRONMENT: "test",
    },
    stdio: "ignore",
  });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:8000/api/v1/health/ready");
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

test("GM turn is applied and reaches the spectator projection", async ({ page, context }) => {
  const security = JSON.parse(
    await readFile(resolve(runtimeDirectory, "security.json"), "utf8"),
  ) as { bootstrap_token: string; spectator_code: string };
  await page.goto(`/api/v1/auth/gm/bootstrap?token=${security.bootstrap_token}`);
  await expect(page.getByRole("heading", { name: "The Clockwork Crossroads" })).toBeVisible();

  await page.getByRole("button", { name: "Запустить" }).click();
  await expect(page.getByLabel("Публичное действие")).toBeVisible();
  const action = "<img src=x onerror=alert(1)> Aria studies the mechanism.";
  await page.getByLabel("Публичное действие").fill(action);
  await page.getByLabel("Мысль модели").fill("This remains private.");
  await page.getByRole("button", { name: "Зафиксировать ход" }).click();
  await expect(page.getByText(action, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Подготовить предложение" }).click();
  await expect(page.getByText("Ожидает подтверждения")).toBeVisible();
  await page.getByRole("button", { name: "Применить изменения" }).click();
  await expect(page.getByText("Ожидает подтверждения")).toBeHidden();

  const spectator = await context.newPage();
  await spectator.goto("/spectator");
  await spectator.getByLabel("Код зрителя").fill(security.spectator_code);
  await spectator.getByRole("button", { name: "Войти в сцену" }).click();
  await expect(spectator.getByText(action, { exact: true })).toBeVisible();
  await expect(spectator.getByText("This remains private.")).toHaveCount(0);

  await page.getByRole("button", { name: "Завершить событие" }).click();
  await expect(page.getByRole("button", { name: "Запустить" })).toBeVisible();
});
