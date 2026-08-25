// Athena's store, as one import. A thin RE-EXPORT BARREL over four themed modules — the same shape
// `src/lib/db/loop-runs.ts` and `src/lib/db/org.ts` use, so call sites import `@/lib/db/athena` and
// never have to know which file a function moved to.
//
//   athena-threads.ts    conversations + turns (titles derived, token counts nullable)
//   athena-proposals.ts  her open asks and how a human answered them
//   athena-identity.ts   constitution (write-locked BY ABSENCE of a writer) + self-model
//   athena-episodes.ts   what she remembers — OrgMemory rows, not a table of her own
//
// The erase path that removes all of it lives with the rest of the sweeps, in
// src/lib/db/retention.ts (eraseOrgAthena).

export {
  ATHENA_THREAD_PAGE,
  ATHENA_TITLE_MAX,
  appendAthenaTurn,
  createAthenaThread,
  deleteAthenaThread,
  deriveThreadTitle,
  getAthenaThread,
  listAthenaThreads,
  listAthenaTurns,
  type AppendTurnInput,
  type AthenaRole,
  type AthenaThreadRecord,
  type AthenaTurnRecord,
} from "@/lib/db/athena-threads";

export {
  ATHENA_PROPOSAL_STATUSES,
  IDENTITY_DIFF_KIND,
  createAthenaProposal,
  getAthenaProposal,
  listOpenAthenaProposals,
  listThreadAthenaProposals,
  resolveAthenaProposal,
  type AthenaProposalRecord,
  type AthenaProposalStatus,
  type CreateProposalInput,
} from "@/lib/db/athena-proposals";

export {
  ATHENA_TIERS,
  getAthenaIdentity,
  getAthenaIdentityPair,
  seedAthenaIdentity,
  updateSelfModel,
  type AthenaIdentityRecord,
  type AthenaTier,
  type SelfModelUpdate,
} from "@/lib/db/athena-identity";

export {
  ATHENA_MEMORY_KIND,
  ATHENA_MEMORY_NAMESPACE,
  ATHENA_MEMORY_SOURCE,
  listAthenaEpisodes,
  writeAthenaEpisode,
  type WriteEpisodeInput,
} from "@/lib/db/athena-episodes";
