import {
  activateCampaignApiV1CampaignsCampaignIdActivatePost,
  applyProposalApiV1CampaignsCampaignIdObserverProposalsProposalIdApplyPost,
  confirmEventFinalizationApiV1CampaignsCampaignIdEventsEventIdFinalizationConfirmPost,
  createProposalApiV1CampaignsCampaignIdEventsEventIdObserverProposalsPost,
  createTurnApiV1CampaignsCampaignIdEventsEventIdTurnsPost,
  generatePlayerTurnApiV1CampaignsCampaignIdJobsPlayerTurnPost,
  generateEventFinalizationApiV1CampaignsCampaignIdJobsEventFinalizationPost,
  getJobApiV1CampaignsCampaignIdJobsJobIdGet,
  gmSnapshotApiV1CampaignsCampaignIdGmSnapshotGet,
  listCampaignsApiV1CampaignsGet,
  sessionInfoApiV1AuthSessionGet,
  snapshotApiV1CampaignsCampaignIdSnapshotGet,
  startEventApiV1CampaignsCampaignIdEventsPost,
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
  campaigns: () => execute(listCampaignsApiV1CampaignsGet(requestOptions)),
  activateCampaign: (campaignId: string) =>
    execute(
      activateCampaignApiV1CampaignsCampaignIdActivatePost({
        ...requestOptions,
        path: { campaign_id: campaignId },
      }),
    ),
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
  generatePlayerTurn: (campaignId: string, eventId: string, characterId: string) =>
    execute(
      generatePlayerTurnApiV1CampaignsCampaignIdJobsPlayerTurnPost({
        ...requestOptions,
        path: { campaign_id: campaignId },
        body: { event_id: eventId, character_id: characterId },
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
    operations: ObserverOperation[],
  ) =>
    execute(
      applyProposalApiV1CampaignsCampaignIdObserverProposalsProposalIdApplyPost({
        ...requestOptions,
        path: { campaign_id: campaignId, proposal_id: proposalId },
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: { operations },
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
