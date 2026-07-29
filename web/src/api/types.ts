import type {
  AddInventoryItemOperation,
  AddStatusEffectOperation,
  CampaignSummary,
  CharacterGm as GeneratedCharacterGm,
  CharacterPublic as GeneratedCharacterPublic,
  GameStateSnapshot as GeneratedGameStateSnapshot,
  InventoryItem as GeneratedInventoryItem,
  ObserverProposalView,
  RemoveInventoryItemOperation,
  RemoveStatusEffectOperation,
  SetAttributeOperation,
  SetResourceOperation,
  UpdateInventoryItemOperation,
} from "./generated";

export type Campaign = CampaignSummary;
export type CharacterPublic = GeneratedCharacterPublic;
export type CharacterGM = GeneratedCharacterGm;
export type GameStateSnapshot = GeneratedGameStateSnapshot;
export type InventoryItem = GeneratedInventoryItem;
export type ObserverProposal = ObserverProposalView;
export type ObserverOperation =
  | SetResourceOperation
  | SetAttributeOperation
  | AddInventoryItemOperation
  | UpdateInventoryItemOperation
  | RemoveInventoryItemOperation
  | AddStatusEffectOperation
  | RemoveStatusEffectOperation;

export interface ProblemDetails {
  type?: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  request_id: string;
  field_errors?: Record<string, string[]>;
}

export interface RealtimeEvent {
  event_id: string;
  campaign_id: string;
  sequence: number;
  type: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}
