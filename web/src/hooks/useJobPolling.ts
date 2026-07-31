import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Фоновые задачи консоли (ход модели, Наблюдатель, сжатие контекста,
 * расшифровка речи) устроены одинаково: POST создаёт джобу, дальше её статус
 * опрашивается до терминального. Раньше этот цикл был скопирован в четырёх
 * местах; здесь он один и умеет то, чего не умели копии, — отмену и честный
 * учёт времени.
 */

/** Общая форма ответа кампанийных и голосовых джоб. */
export interface PollableJob {
  status: string;
  error_code?: string | null;
  output_data?: { [key: string]: unknown } | null;
}

/** Статусы, после которых опрашивать джобу бессмысленно. */
const FAILED_STATUSES = new Set(["failed", "degraded", "cancelled"]);
const DEFAULT_INTERVAL_MS = 500;

/**
 * Пять минут — это страховка от зависшей джобы, а не мера терпения ГМ-а: ждать
 * или отменить, он решает сам по таймеру в полосе состояния. Прежние 90 секунд
 * рвали сжатие контекста на deepseek (замеряно 150 с) — ГМ получал ошибку про
 * операцию, которая на самом деле заканчивалась успешно.
 */
const DEFAULT_TIMEOUT_MS = 300_000;

export class JobCancelledError extends Error {
  constructor() {
    super("Операция отменена.");
    this.name = "JobCancelledError";
  }
}

export class JobTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobTimeoutError";
  }
}

export class JobFailedError extends Error {
  constructor(
    message: string,
    readonly jobStatus: string,
    readonly errorCode?: string | null,
  ) {
    super(message);
    this.name = "JobFailedError";
  }
}

/** Отмена во время паузы между опросами не должна ждать конца паузы. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new JobCancelledError());
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new JobCancelledError());
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface RunJobOptions<TJob extends PollableJob> {
  /** Создаёт джобу и возвращает её идентификатор. */
  start: () => Promise<{ id: string }>;
  fetchJob: (jobId: string) => Promise<TJob>;
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
  describeFailure?: (job: TJob) => string;
  timeoutMessage?: string;
}

export async function runJob<TJob extends PollableJob>({
  start,
  fetchJob,
  signal,
  intervalMs = DEFAULT_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  describeFailure = (job) => `Задача завершилась со статусом ${job.error_code ?? job.status}.`,
  timeoutMessage = "Задача не завершилась вовремя.",
}: RunJobOptions<TJob>): Promise<TJob> {
  if (signal?.aborted) throw new JobCancelledError();
  const created = await start();

  /* Дедлайн по стенным часам, а не счётчик попыток: прежний код спал
     фиксированные 500 мс 180 раз и не учитывал длительность самих запросов,
     поэтому фактический лимит уползал далеко за заявленные 90 секунд. */
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (signal?.aborted) throw new JobCancelledError();
    const job = await fetchJob(created.id);
    if (job.status === "succeeded") return job;
    if (FAILED_STATUSES.has(job.status)) {
      throw new JobFailedError(describeFailure(job), job.status, job.error_code);
    }
    if (Date.now() >= deadline) throw new JobTimeoutError(timeoutMessage);
    await delay(intervalMs, signal);
  }
}

export interface JobRunnerOptions<TJob extends PollableJob, TResult, TInput>
  extends Omit<RunJobOptions<TJob>, "start" | "signal"> {
  start: (input: TInput) => Promise<{ id: string }>;
  /** Достаёт полезную нагрузку. Наблюдателю нужен ещё один запрос — можно async. */
  parse: (job: TJob) => TResult | Promise<TResult>;
  onSuccess?: (result: TResult) => void;
}

/**
 * Обёртка над {@link runJob} со счётчиком времени и отменой — тем, что нужно
 * панелям, чтобы показать прогресс вместо задизейбленной кнопки.
 */
export function useJobRunner<TJob extends PollableJob, TResult, TInput = void>(
  options: JobRunnerOptions<TJob, TResult, TInput>,
) {
  const abortRef = useRef<AbortController | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  /* Замыкаемся на options напрямую: useMutation обновляет свои опции на каждом
     рендере, поэтому mutate() всегда вызывает свежий mutationFn. */
  const mutation = useMutation({
    mutationFn: async (input: TInput) => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const job = await runJob<TJob>({
          ...options,
          start: () => options.start(input),
          signal: controller.signal,
        });
        return await options.parse(job);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    onMutate: () => setElapsedMs(0),
    onSuccess: (result) => options.onSuccess?.(result),
  });

  const { isPending } = mutation;
  useEffect(() => {
    if (!isPending) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    return () => window.clearInterval(timer);
  }, [isPending]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return {
    run: mutation.mutate,
    runAsync: mutation.mutateAsync,
    reset: mutation.reset,
    cancel,
    data: mutation.data,
    isPending,
    elapsedMs,
    /* Отмена — это решение GM, а не сбой: наружу как ошибку не отдаём. */
    error: mutation.error instanceof JobCancelledError ? null : mutation.error,
  };
}
