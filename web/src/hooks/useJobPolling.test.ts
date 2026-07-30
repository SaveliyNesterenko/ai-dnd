import { describe, expect, it, vi } from "vitest";

import {
  JobCancelledError,
  JobFailedError,
  JobTimeoutError,
  type PollableJob,
  runJob,
} from "./useJobPolling";

/** Отдаёт статусы по очереди, чтобы сымитировать очередь → выполняется → итог. */
function jobSequence(...statuses: PollableJob[]) {
  const queue = [...statuses];
  return vi.fn(() => Promise.resolve(queue.shift() ?? statuses[statuses.length - 1]!));
}

const start = () => Promise.resolve({ id: "job-1" });

describe("runJob", () => {
  it("возвращает джобу после успешного завершения", async () => {
    const fetchJob = jobSequence(
      { status: "queued" },
      { status: "running" },
      { status: "succeeded", output_data: { transcript: "готово" } },
    );

    const job = await runJob({ start, fetchJob, intervalMs: 1 });

    expect(job.output_data).toEqual({ transcript: "готово" });
    expect(fetchJob).toHaveBeenCalledTimes(3);
  });

  it("падает на degraded и сообщает код ошибки", async () => {
    const fetchJob = jobSequence({ status: "degraded", error_code: "llm_unavailable" });

    const error = await runJob({
      start,
      fetchJob,
      intervalMs: 1,
      describeFailure: (job) => `Наблюдатель недоступен: ${job.error_code}`,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(JobFailedError);
    expect(error).toMatchObject({
      message: "Наблюдатель недоступен: llm_unavailable",
      jobStatus: "degraded",
      errorCode: "llm_unavailable",
    });
  });

  it("прекращает опрос по дедлайну", async () => {
    const fetchJob = jobSequence({ status: "running" });

    const error = await runJob({
      start,
      fetchJob,
      intervalMs: 1,
      timeoutMs: 0,
      timeoutMessage: "Модель не ответила вовремя.",
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(JobTimeoutError);
    expect((error as Error).message).toBe("Модель не ответила вовремя.");
  });

  it("прерывается по сигналу отмены, не дожидаясь конца паузы", async () => {
    const controller = new AbortController();
    const fetchJob = vi.fn(() => {
      controller.abort();
      return Promise.resolve({ status: "running" } satisfies PollableJob);
    });

    const error = await runJob({
      start,
      fetchJob,
      // Пауза заведомо длиннее теста: отмена обязана разбудить ожидание сразу.
      intervalMs: 60_000,
      signal: controller.signal,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(JobCancelledError);
    expect(fetchJob).toHaveBeenCalledTimes(1);
  });

  it("не создаёт джобу, если сигнал уже отменён", async () => {
    const startSpy = vi.fn(start);
    const controller = new AbortController();
    controller.abort();

    const error = await runJob({
      start: startSpy,
      fetchJob: jobSequence({ status: "succeeded" }),
      signal: controller.signal,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(JobCancelledError);
    expect(startSpy).not.toHaveBeenCalled();
  });
});
