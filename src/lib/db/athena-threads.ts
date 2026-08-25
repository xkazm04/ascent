// ATHENA'S CONVERSATIONS — threads and the turns inside them.
//
// TITLES ARE DERIVED, NEVER TYPED. A "name this conversation" box is a chore charged before the
// operator has said anything, and the thing they were about to say IS the title. `deriveThreadTitle`
// takes the first user message and the thread names itself; there is no setter, because a title that
// can drift from the conversation it names is worse than a slightly clumsy derived one.
//
// TOKEN COUNTS ARE NULLABLE AND `0` IS NEVER WRITTEN FOR "unknown". A provider that reports no usage
// (a local model, a degraded fallback path) has told us nothing — and a 0 written here is summed and
// averaged downstream as a measurement. Unknown is not a value; `null` says so.

import { getPrisma, isDbConfigured } from "@/lib/db/client";

/** Longest derived title kept in full. Past this the title is cut on a word boundary and elided. */
export const ATHENA_TITLE_MAX = 72;
/** Default page size for the thread rail. */
export const ATHENA_THREAD_PAGE = 30;

export type AthenaRole = "user" | "assistant";

export interface AthenaTurnRecord {
  id: string;
  threadId: string;
  role: AthenaRole;
  content: string;
  /** Decoded `metaJson`: blocks, recall chips, proposal ids, the phase trail, grounding, truncated. */
  meta: Record<string, unknown>;
  /** null = the provider reported no usage. NOT zero — see the header. */
  inputTokens: number | null;
  outputTokens: number | null;
  legs: number | null;
  createdAt: string;
}

export interface AthenaThreadRecord {
  id: string;
  orgId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The title a thread gets from its first user message: first non-empty line, markdown chrome and
 * collapsed whitespace removed, cut on a word boundary. Pure — unit-testable without a database.
 */
export function deriveThreadTitle(firstUserMessage: string): string {
  const firstLine = firstUserMessage
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return "";
  const cleaned = firstLine
    .replace(/^#{1,6}\s+/, "") // a heading is still just what they said
    .replace(/^[-*+]\s+/, "") // ...so is a bullet
    .replace(/^>\s+/, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= ATHENA_TITLE_MAX) return cleaned;
  const cut = cleaned.slice(0, ATHENA_TITLE_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > ATHENA_TITLE_MAX / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function parseMeta(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // A malformed column must not crash a transcript render three layers up in a React tree.
    return {};
  }
}

type ThreadRow = { id: string; orgId: string; title: string; createdAt: Date; updatedAt: Date };
type TurnRow = {
  id: string;
  threadId: string;
  role: string;
  content: string;
  metaJson: string;
  inputTokens: number | null;
  outputTokens: number | null;
  legs: number | null;
  createdAt: Date;
};

const toThread = (r: ThreadRow): AthenaThreadRecord => ({
  id: r.id,
  orgId: r.orgId,
  title: r.title,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const toTurn = (r: TurnRow): AthenaTurnRecord => ({
  id: r.id,
  threadId: r.threadId,
  role: r.role === "user" ? "user" : "assistant",
  content: r.content,
  meta: parseMeta(r.metaJson),
  inputTokens: r.inputTokens,
  outputTokens: r.outputTokens,
  legs: r.legs,
  createdAt: r.createdAt.toISOString(),
});

// ── threads ──────────────────────────────────────────────────────────────────────────────────────

/** Open a new, untitled conversation. It names itself when the first user turn lands. */
export async function createAthenaThread(orgId: string): Promise<AthenaThreadRecord | null> {
  if (!isDbConfigured() || !orgId) return null;
  return toThread(await getPrisma().athenaThread.create({ data: { orgId } }));
}

/** The org's conversations, most recently active first. */
export async function listAthenaThreads(orgId: string, limit = ATHENA_THREAD_PAGE): Promise<AthenaThreadRecord[]> {
  if (!isDbConfigured() || !orgId) return [];
  const rows = await getPrisma().athenaThread.findMany({
    where: { orgId },
    orderBy: { updatedAt: "desc" },
    take: Math.max(1, Math.min(200, Math.round(limit))),
  });
  return rows.map(toThread);
}

/** One thread, ANDed with `orgId` — the tenant boundary is never taken from the id alone. */
export async function getAthenaThread(orgId: string, threadId: string): Promise<AthenaThreadRecord | null> {
  if (!isDbConfigured() || !orgId || !threadId) return null;
  const row = await getPrisma().athenaThread.findFirst({ where: { id: threadId, orgId } });
  return row ? toThread(row) : null;
}

/** A thread's turns, oldest first — the transcript order. */
export async function listAthenaTurns(orgId: string, threadId: string, limit = 200): Promise<AthenaTurnRecord[]> {
  if (!isDbConfigured() || !orgId || !threadId) return [];
  const thread = await getPrisma().athenaThread.findFirst({ where: { id: threadId, orgId }, select: { id: true } });
  if (!thread) return [];
  const rows = await getPrisma().athenaTurn.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(1000, Math.round(limit))),
  });
  return rows.map(toTurn);
}

// ── turns ────────────────────────────────────────────────────────────────────────────────────────

export interface AppendTurnInput {
  orgId: string;
  threadId: string;
  role: AthenaRole;
  content: string;
  /** Blocks, recall chips, proposal ids, the phase trail, `grounding`, `truncated`. */
  meta?: Record<string, unknown>;
  /** Pass `null` (or omit) when the provider reported nothing. NEVER pass 0 to mean "unknown". */
  inputTokens?: number | null;
  outputTokens?: number | null;
  legs?: number | null;
}

/** A count is written only when it is a real measurement; anything else is stored as `null`. */
const asCount = (n: number | null | undefined): number | null =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;

/**
 * Append a turn and bump the thread's `updatedAt` (so the rail's ordering is "last spoken", not
 * "created"). The FIRST user turn also names the thread — one write, not a second round trip that
 * could fail and leave a permanently untitled conversation.
 */
export async function appendAthenaTurn(input: AppendTurnInput): Promise<AthenaTurnRecord | null> {
  if (!isDbConfigured() || !input.orgId || !input.threadId) return null;
  const prisma = getPrisma();
  const thread = await prisma.athenaThread.findFirst({
    where: { id: input.threadId, orgId: input.orgId },
    select: { id: true, title: true },
  });
  if (!thread) return null;

  const title = !thread.title && input.role === "user" ? deriveThreadTitle(input.content) : null;

  return await prisma.$transaction(async (tx) => {
    const turn = await tx.athenaTurn.create({
      data: {
        threadId: thread.id,
        role: input.role,
        content: input.content,
        metaJson: JSON.stringify(input.meta ?? {}),
        inputTokens: asCount(input.inputTokens),
        outputTokens: asCount(input.outputTokens),
        legs: asCount(input.legs),
      },
    });
    await tx.athenaThread.update({
      where: { id: thread.id },
      // `updatedAt` is @updatedAt, so any update touches it; the title write is what carries it here
      // when there is one, and `{}` is the no-op that still bumps the timestamp.
      data: title ? { title } : {},
    });
    return toTurn(turn);
  });
}

/**
 * Delete one conversation: proposals → turns → thread. relationMode = "prisma" emits NO cascade, so
 * the child order is written by hand — the same delete-graph convention pruneRepoScans follows.
 * Org-ANDed: a thread id from another tenant deletes nothing.
 */
export async function deleteAthenaThread(orgId: string, threadId: string): Promise<boolean> {
  if (!isDbConfigured() || !orgId || !threadId) return false;
  const prisma = getPrisma();
  const thread = await prisma.athenaThread.findFirst({ where: { id: threadId, orgId }, select: { id: true } });
  if (!thread) return false;
  await prisma.$transaction(async (tx) => {
    await tx.athenaProposal.deleteMany({ where: { threadId: thread.id } });
    await tx.athenaTurn.deleteMany({ where: { threadId: thread.id } });
    await tx.athenaThread.delete({ where: { id: thread.id } });
  });
  return true;
}
