import {
  activateCampaignApiV1CampaignsCampaignIdActivatePost,
  applyProposalApiV1CampaignsCampaignIdObserverProposalsProposalIdApplyPost,
  capabilitiesApiV1CapabilitiesGet,
  confirmEventFinalizationApiV1CampaignsCampaignIdEventsEventIdFinalizationConfirmPost,
  createProposalApiV1CampaignsCampaignIdEventsEventIdObserverProposalsPost,
  createTurnApiV1CampaignsCampaignIdEventsEventIdTurnsPost,
  deleteTurnApiV1CampaignsCampaignIdTurnsTurnIdDelete,
  generateContextCompressionApiV1CampaignsCampaignIdJobsContextCompressionPost,
  generateEventFinalizationApiV1CampaignsCampaignIdJobsEventFinalizationPost,
  generateObserverProposalApiV1CampaignsCampaignIdJobsObserverPost,
  generatePlayerTurnApiV1CampaignsCampaignIdJobsPlayerTurnPost,
  getJobApiV1CampaignsCampaignIdJobsJobIdGet,
  getProposalApiV1CampaignsCampaignIdObserverProposalsProposalIdGet,
  getVoiceJobApiV1VoiceJobsJobIdGet,
  gmSnapshotApiV1CampaignsCampaignIdGmSnapshotGet,
  listCampaignsApiV1CampaignsGet,
  listJobsApiV1CampaignsCampaignIdJobsGet,
  resynthesizeTurnSpeechApiV1CampaignsCampaignIdTurnsTurnIdSpeechPost,
  sessionInfoApiV1AuthSessionGet,
  skipSpeechApiV1CampaignsCampaignIdSpeechSkipPost,
  snapshotApiV1CampaignsCampaignIdSnapshotGet,
  startEventApiV1CampaignsCampaignIdEventsPost,
  transcribeAudioApiV1VoiceJobsTranscriptionPost,
  updateSpeechSettingsApiV1CampaignsCampaignIdSpeechPatch,
  updateSceneApiV1CampaignsCampaignIdScenePatch,
  updateSceneCharacterApiV1CampaignsCampaignIdSceneCharactersCharacterIdPatch,
  updateCharacterApiV1CampaignsCampaignIdCharactersCharacterIdPatch,
} from "./generated";
import { client } from "./generated/client.gen";
import type {
  ConfirmEventFinalizationRequest,
  CreateObserverProposalRequest,
  CreateTurnRequest,
  UpdateSceneCharacterRequest,
  UpdateSceneRequest,
  UpdateCharacterRequest,
  UpdateSpeechSettingsRequest,
} from "./generated/types.gen";
import type { ObserverOperation, ProblemDetails } from "./types";

client.setConfig({ credentials: "same-origin" });

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly problem?: ProblemDetails,
  ) {
    super(message);
  }
}

async function execute<T>(request: Promise<{ data: T }>): Promise<T> {
  try {
    return (await request).data;
  } catch (error) {
    const problem =
      typeof error === "object" && error !== null ? (error as Partial<ProblemDetails>) : undefined;
    throw new ApiError(
      problem?.detail ?? "Request failed.",
      problem?.status ?? 0,
      problem as ProblemDetails | undefined,
    );
  }
}

const requestOptions = {
  throwOnError: true as const,
};

export const api = {
  capabilities: () => execute(capabilitiesApiV1CapabilitiesGet(requestOptions)),
  campaigns: () => execute(listCampaignsApiV1CampaignsGet(requestOptions)),
  activateCampaign: (campaignId: string) =>
    execute(
      activateCampaignApiV1CampaignsCampaignIdActivatePost({
        ...requestOptions,
        path: { campaign_id: campaignId },
      }),
    ),
  importCampaignPack: async (file: File) => {
    const response = await fetch("/api/v1/campaign-packs/import", {
      method: "POST",
      credentials: "same-origin",
      body: (() => {
        const form = new FormData();
        form.append("file", file);
        return form;
      })(),
    });
    if (!response.ok) {
      const problem = (await response.json().catch(() => undefined)) as ProblemDetails | undefined;
      throw new ApiError(problem?.detail ?? "Campaign import failed.", response.status, problem);
    }
    return response.json() as Promise<{
      campaign_id: string;
      campaign_name: string;
      characters: number;
      locations: number;
      music_tracks: number;
    }>;
  },
  gmSession: () =>
    execute(sessionInfoApiV1AuthSessionGet(requestOptions)) as Promise<{
      role: "gm";
      spectator_code: string;
    }>,
  gmSnapshot: (campaignId: string) =>
    execute(
      gmSnapshotApiV1CampaignsCampaignIdGmSnapshotGet({
        ...requestOptions,
        path: { campaign_id: campaignId },
      }),
    ),
  publicSnapshot: (campaignId: string, joinCode: string) =>
    execute(
      snapshotApiV1CampaignsCampaignIdSnapshotGet({
        ...requestOptions,
        path: { campaign_id: campaignId },
        query: { spectator_code: joinCode, view: "public" },
      }),
    ),
  startEvent: (campaignId: string, title: string) =>
    execute(
      startEventApiV1CampaignsCampaignIdEventsPost({
        ...requestOptions,
        path: { campaign_id: campaignId },
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: { title },
      }),
    ) as Promise<{ id: string; title: string; status: string }>,
  createTurn: (
    campaignId: string,
    eventId: string,
    input: CreateTurnRequest,
  ) =>
    execute(
      createTurnApiV1CampaignsCampaignIdEventsEventIdTurnsPost({
        ...requestOptions,
        path: { campaign_id: campaignId, event_id: eventId },
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: input,
      }),
    ) as Promise<{ id: string }>,
  deleteTurn: (campaignId: string, turnId: string) =>
    execute(
      deleteTurnApiV1CampaignsCampaignIdTurnsTurnIdDelete({
        ...requestOptions,
        path: { campaign_id: campaignId, turn_id: turnId },
      }),
    ),
  generatePlayerTurn: (campaignId: string, eventId: string, characterId: string) =>
    execute(
      generatePlayerTurnApiV1CampaignsCampaignIdJobsPlayerTurnPost({
        ...requestOptions,
        path: { campaign_id: campaignId },
        body: { event_id: eventId, character_id: characterId },
      }),
    ),
  /** Очередь озвучки: активные задачи плюс хвост недавних — одним запросом. */
  speechJobs: (campaignId: string) =>
    execute(
      listJobsApiV1CampaignsCampaignIdJobsGet({
        ...requestOptions,
        path: { campaign_id: campaignId },
        query: { kind: "speech_synthesis", limit: 12 },
      }),
    ),
  resynthesizeTurnSpeech: (campaignId: string, turnId: string) =>
    execute(
      resynthesizeTurnSpeechApiV1CampaignsCampaignIdTurnsTurnIdSpeechPost({
        ...requestOptions,
        path: { campaign_id: campaignId, turn_id: turnId },
      }),
    ),
  skipSpeech: (campaignId: string, turnId: string | null) =>
    execute(
      skipSpeechApiV1CampaignsCampaignIdSpeechSkipPost({
        ...requestOptions,
        path: { campaign_id: campaignId },
        body: { turn_id: turnId },
      }),
    ),
  updateSpeechSettings: (campaignId: string, input: UpdateSpeechSettingsRequest) =>
    execute(
      updateSpeechSettingsApiV1CampaignsCampaignIdSpeechPatch({
        ...requestOptions,
        path: { campaign_id: campaignId },
        body: input,
      }),
    ),
  getJob: (campaignId: string, jobId: string) =>
    execute(
      getJobApiV1CampaignsCampaignIdJobsJobIdGet({
        ...requestOptions,
        path: { campaign_id: campaignId, job_id: jobId },
      }),
    ),
  generateEventFinalization: (
    campaignId: string,
    eventId: string,
    baseRevision: number,
  ) =>
    execute(
      generateEventFinalizationApiV1CampaignsCampaignIdJobsEventFinalizationPost({
        ...requestOptions,
        path: { campaign_id: campaignId },
        body: { event_id: eventId, base_revision: baseRevision },
      }),
    ),
  generateContextCompression: (
    campaignId: string,
    eventId: string,
    baseRevision: number,
  ) =>
    execute(
      generateContextCompressionApiV1CampaignsCampaignIdJobsContextCompressionPost({
        ...requestOptions,
        path: { campaign_id: campaignId },
        body: { event_id: eventId, base_revision: baseRevision },
      }),
    ),
  generateObserver: (campaignId: string, eventId: string, turnId: string) =>
    execute(
      generateObserverProposalApiV1CampaignsCampaignIdJobsObserverPost({
        ...requestOptions,
        path: { campaign_id: campaignId },
        body: { event_id: eventId, turn_id: turnId },
      }),
    ),
  transcribeVoice: (file: File) =>
    execute(
      transcribeAudioApiV1VoiceJobsTranscriptionPost({
        ...requestOptions,
        body: { file },
      }),
    ),
  getVoiceJob: (jobId: string) =>
    execute(
      getVoiceJobApiV1VoiceJobsJobIdGet({
        ...requestOptions,
        path: { job_id: jobId },
      }),
    ),
  getProposal: (campaignId: string, proposalId: string) =>
    execute(
      getProposalApiV1CampaignsCampaignIdObserverProposalsProposalIdGet({
        ...requestOptions,
        path: { campaign_id: campaignId, proposal_id: proposalId },
      }),
    ),
  updateScene: (campaignId: string, input: UpdateSceneRequest) =>
    execute(
      updateSceneApiV1CampaignsCampaignIdScenePatch({
        ...requestOptions,
        path: { campaign_id: campaignId },
        body: input,
      }),
    ),
  updateSceneCharacter: (
    campaignId: string,
    characterId: string,
    input: UpdateSceneCharacterRequest,
  ) =>
    execute(
      updateSceneCharacterApiV1CampaignsCampaignIdSceneCharactersCharacterIdPatch({
        ...requestOptions,
        path: { campaign_id: campaignId, character_id: characterId },
        body: input,
      }),
    ),
  updateCharacter: (
    campaignId: string,
    characterId: string,
    input: UpdateCharacterRequest,
  ) =>
    execute(
      updateCharacterApiV1CampaignsCampaignIdCharactersCharacterIdPatch({
        ...requestOptions,
        path: { campaign_id: campaignId, character_id: characterId },
        body: input,
      }),
    ),
  createProposal: (
    campaignId: string,
    eventId: string,
    input: CreateObserverProposalRequest,
  ) =>
    execute(
      createProposalApiV1CampaignsCampaignIdEventsEventIdObserverProposalsPost({
        ...requestOptions,
        path: { campaign_id: campaignId, event_id: eventId },
        body: input,
      }),
    ),
  applyProposal: (
    campaignId: string,
    proposalId: string,
    gmBrief: string,
    operations: ObserverOperation[],
  ) =>
    execute(
      applyProposalApiV1CampaignsCampaignIdObserverProposalsProposalIdApplyPost({
        ...requestOptions,
        path: { campaign_id: campaignId, proposal_id: proposalId },
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: { gm_brief: gmBrief, operations },
      }),
    ),
  confirmEventFinalization: (
    campaignId: string,
    eventId: string,
    input: ConfirmEventFinalizationRequest,
  ) =>
    execute(
      confirmEventFinalizationApiV1CampaignsCampaignIdEventsEventIdFinalizationConfirmPost({
        ...requestOptions,
        path: { campaign_id: campaignId, event_id: eventId },
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: input,
      }),
    ) as Promise<{ id: string; status: string; revision: number }>,
};
