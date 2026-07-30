import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VoiceWorkspace } from "./VoiceWorkspace";

const transcribeVoice = vi.fn();
const getVoiceJob = vi.fn();
const createTurn = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    transcribeVoice: (file: File) => transcribeVoice(file) as unknown,
    getVoiceJob: (jobId: string) => getVoiceJob(jobId) as unknown,
    createTurn: (campaignId: string, eventId: string, input: unknown) =>
      createTurn(campaignId, eventId, input) as unknown,
  },
}));

class FakeMediaRecorder {
  static isTypeSupported(type: string) {
    return type === "audio/webm;codecs=opus";
  }

  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(
    readonly stream: MediaStream,
    readonly options?: { mimeType?: string },
  ) {}

  get mimeType() {
    return this.options?.mimeType ?? "";
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["opus"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function stubMediaDevices(getUserMedia: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
}

function renderWorkspace(eventId?: string) {
  const onChanged = vi.fn();
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <VoiceWorkspace campaignId="camp-1" eventId={eventId} onChanged={onChanged} />
    </QueryClientProvider>,
  );
  return { onChanged, ...result };
}

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  stubMediaDevices(() =>
    Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream),
  );
  transcribeVoice.mockResolvedValue({ id: "job-1" });
  getVoiceJob.mockResolvedValue({
    id: "job-1",
    status: "succeeded",
    output_data: { transcript: "Гоблины окружают отряд." },
  });
  createTurn.mockResolvedValue({ id: "turn-1" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("VoiceWorkspace", () => {
  it("records, transcribes and publishes the text as a GM turn", async () => {
    const { onChanged } = renderWorkspace("event-1");
    const record = screen.getByRole("button", { name: "Запись голоса" });

    fireEvent.click(record);
    const stop = await screen.findByRole("button", { name: "Остановить запись" });
    expect(stop).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(stop);

    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(
      "Распознанный текст GM",
    );
    await waitFor(() => {
      expect(textarea.value).toBe("Гоблины окружают отряд.");
    });
    const uploaded = transcribeVoice.mock.calls[0]![0] as File;
    expect(uploaded.name).toBe("gm-speech.webm");
    expect(uploaded.type).toBe("audio/webm");

    fireEvent.change(textarea, { target: { value: "Гоблины окружают отряд!" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить в лог" }));

    await waitFor(() => {
      expect(createTurn).toHaveBeenCalledWith("camp-1", "event-1", {
        character_id: null,
        actor_name: "Game Master",
        actor_role: "gm",
        action: "Гоблины окружают отряд!",
        roll_dice: false,
      });
    });
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });
    expect(textarea.value).toBe("");
  });

  it("explains a denied microphone instead of crashing", async () => {
    const denied = new Error("Permission denied");
    denied.name = "NotAllowedError";
    stubMediaDevices(() => Promise.reject(denied));
    renderWorkspace("event-1");

    fireEvent.click(screen.getByRole("button", { name: "Запись голоса" }));

    expect(await screen.findByText("Микрофон недоступен")).toBeInTheDocument();
    expect(
      screen.getByText(/Разрешите запись звука для этой страницы/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Запись голоса" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(transcribeVoice).not.toHaveBeenCalled();
  });

  it("keeps the log button disabled without an active event", () => {
    renderWorkspace();

    expect(screen.getByRole("button", { name: "Отправить в лог" })).toBeDisabled();
    expect(
      screen.getByText("Запустите игровое событие, чтобы отправлять реплики в лог."),
    ).toBeInTheDocument();
  });

  it("reports a failed transcription job", async () => {
    getVoiceJob.mockResolvedValue({ id: "job-1", status: "degraded", error_code: "stt_disabled" });
    renderWorkspace("event-1");

    fireEvent.click(screen.getByRole("button", { name: "Запись голоса" }));
    fireEvent.click(await screen.findByRole("button", { name: "Остановить запись" }));

    expect(
      await screen.findByText("Не удалось расшифровать запись: stt_disabled"),
    ).toBeInTheDocument();
  });
});
