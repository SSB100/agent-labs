import type { JsonObject } from "./contracts";

/** R04 persists intent only. No caller can turn a confirmation into dispatch authority. */
export const R04_EXECUTION = { executionAvailable: false, executionBlockedReason: "r05_admission_required" } as const;
export type R04Preference = "draft" | "ready" | "paused" | "stopped" | "completed";
export type R04BusinessContent = {
  brandContext: string; operatingRules: string; allowedActivity: string; restrictions: string;
};
export type R04QuestContent = {
  title: string; originalIntent: string; objective: string;
  /** Parsed facts, with unresolved facts represented by null/ambiguities, never defaults. */
  parsed: JsonObject;
  ambiguities: string[];
};
export type R04Envelope = {
  purposes: string[]; operations: string[];
  accounts: Array<{ id: string; revision: string }>;
  packs: Array<{ installationId: string; packId: string }>;
  dataSharing: string[];
  limits: Array<{ category: string; currency: string; maximum: string }>;
  startsAt: string; expiresAt: string; stopRules: string[];
};
export type R04Payloads = {
  "business.save": { expectedRevision: number; content: R04BusinessContent; preference: "setup" | "paused" | "stopped" };
  "quest.save": { goalId: string | null; expectedRevision: number; content: R04QuestContent };
  "quest.preference": { goalId: string; expectedRevision: number; preference: R04Preference };
  "quest.select": { goalId: string; expectedRevision: number };
  "envelope.propose": { goalId: string; expectedRevision: number; businessRevision: number; envelope: R04Envelope };
  "envelope.confirm": { proposalId: string; proposalHash: string };
  "envelope.revoke": { proposalId: string };
  "research.link": { experimentId: string; goalId: string; expectedRevision: number };
};
export type R04Operation = keyof R04Payloads;
export type R04Revision<T> = { revision: number; content: T; createdAt: string; hash: string };
export type R04QuestRow = { id: string; businessId: string; revision: number; title: string; preference: R04Preference; createdAt: string; updatedAt: string };
export type R04Proposal = { id: string; goalId: string; goalRevision: number; businessRevision: number; envelope: R04Envelope; hash: string; createdAt: string; confirmation: { id: string; confirmedAt: string } | null; revoked: boolean; effective: boolean; status: "proposed" | "confirmed_intent_only" | "stale" | "revoked" | "expired" };
export type R04Read = typeof R04_EXECUTION & {
  businessId: string;
  business: { revision: number; content: R04BusinessContent | null; preference: "legacy_unmanaged" | "setup" | "paused" | "stopped"; currentGoalId: string | null };
  quests: R04QuestRow[]; total: number; limit: number; offset: number;
  selection: "explicit" | "current" | "last" | "none"; selected: (R04QuestRow & { content: R04QuestContent; hash: string; proposals: R04Proposal[] }) | null;
  proposalsComplete: boolean;
  references: { accounts: Array<{id: string; revision: string; label: string}>; packs: Array<{installationId: string; packId: string; label: string; version: string}>; accountsComplete: boolean; packsComplete: boolean };
};
export type R04ResearchPreview = { status: "linkable" | "legacy_bound" | "unlinked_ambiguous" | "unavailable"; reason?: string; businessId?: string; experimentIds?: string[]; goalId?: string | null; authorityRootId?: string | null; evidence?: JsonObject };
export type R04Result = typeof R04_EXECUTION & { operation: R04Operation; id: string; revision?: number; replayed: boolean; status?: R04Proposal["status"] };
export const R04_RPC = { read: "r04_quest_read", transition: "r04_quest_transition", research: "r04_research_link_preview" } as const;
