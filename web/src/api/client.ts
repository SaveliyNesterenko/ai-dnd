import {
  activateCampaignApiV1CampaignsCampaignIdActivatePost,
  applyProposalApiV1CampaignsCampaignIdObserverProposalsProposalIdApplyPost,
  archiveEventApiV1CampaignsCampaignIdEventsEventIdArchivePost,
  createProposalApiV1CampaignsCampaignIdEventsEventIdObserverProposalsPost,
  createTurnApiV1CampaignsCampaignIdEventsEventIdTurnsPost,
  gmSnapshotApiV1CampaignsCampaignIdGmSnapshotGet,
  listCampaignsApiV1CampaignsGet,
  sessionInfoApiV1AuthSessionGet,
  snapshotApiV1CampaignsCampaignIdSnapshotGet,
  startEventApiV1CampaignsCampaignIdEventsPost,
} from "./generated";
import { client } from "./generated/client.gen";
import type {
  CreateObserverProposalRequest,
  CreateTurnRequest,
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
  archiveEvent: (campaignId: string, eventId: string) =>
    execute(
      archiveEventApiV1CampaignsCampaignIdEventsEventIdArchivePost({
        ...requestOptions,
        path: { campaign_id: campaignId, event_id: eventId },
        headers: { "Idempotency-Key": crypto.randomUUID() },
      }),
    ) as Promise<{ id: string; status: string }>,
};
