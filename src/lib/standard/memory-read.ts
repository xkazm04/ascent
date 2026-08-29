// READING `.ai/memory/` — the parser half of the standard whose WRITER is `standard/memory.ts`.
//
// `memory.ts` seeds the format (frontmatter + one fact per file, an open `kind`/`scope` vocabulary).
// This module reads it back out of a scanned repository so those entries can be mirrored into Shared
// Org Memory (moonshot #14). One spec, two directions, deliberately co-located: a change to the seed's
// frontmatter block and a change to this parser belong in the same diff.
//
// DELIBERATELY NOT A YAML DEPENDENCY, for the same reason `src/lib/org/skill-frontmatter.ts` isn't: the
// block is a handful of flat scalars plus one list, and the input is UNTRUSTED text from a customer
// repository. A line parser cannot be talked into constructing an object, resolving an anchor, or
// running a tag.
//
// PURE: no I/O, no DB, no network. The one Node dependency is `node:crypto` for the content hash —
// which is what makes the upsert idempotent, and is the reason this module is server-resident rather
// than client-safe. Nothing under `src/features/**` imports it; the UI reads mirrored ROWS.
//
// WHAT THE PARSER REFUSES TO GUESS: an entry with no frontmatter block, or with a whitespace-only
// body, is SKIPPED and counted with a reason — never inferred into a shape. A skipped entry is an
// honest absence; an invented one is a memory the org never wrote.

import { createHash } from "node:crypto";
import { normalizeMemoryKind, type MemoryKind } from "@/lib/org/memory-kinds";

/** Body cap. Bounds one mirrored row, the OrgMemory content it feeds, and any prompt built from it. */
export const MAX_MEMORY_BODY = 6000;

/** One parsed `.ai/memory/NNNN-*.md` entry. Every field is either read from the document or null. */
export interface RepoMemoryEntry {
  path: string;
  /** Frontmatter `id`, VERBATIM ("0007"). Null when absent — never 0, never derived from the filename:
   *  the filename number and the declared id are different claims and only one of them is the id. */
  entryId: string | null;
  /** `kind` exactly as written. The vocabulary is open by contract, so the raw value is never lost. */
  rawKind: string | null;
  /** The curated OrgMemory kind this maps onto. See {@link mapMemoryKind}. */
  mappedKind: MemoryKind;
  scope: string | null;
  /** `date` as VERBATIM TEXT. Repo-authored, not a timestamp: parsing it to a Date would invent
   *  precision the document does not carry, and put a Date on a row type that crosses to a client. */
  entryDate: string | null;
  supersedes: string | null;
  refs: string[];
  /** The markdown body, trimmed and capped at {@link MAX_MEMORY_BODY}. */
  body: string;
  /** First 32 hex of sha256(path \0 body) — deterministic, which is what makes the upsert idempotent. */
  contentHash: string;
  /** True when the body was longer than the cap. Recorded as `skipReason: "capped"` on the row rather
   *  than dropped, so a reader can tell a truncated memory from a short one. */
  truncated: boolean;
}

export type MemorySkipReason = "malformed" | "empty";

export interface RepoMemoryParse {
  entries: RepoMemoryEntry[];
  skipped: { path: string; reason: MemorySkipReason }[];
}

const KEY_RE = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/;
const MAX_SCALAR = 200;
const MAX_REFS = 20;

/** Strip one layer of matching quotes. */
function unquote(v: string): string {
  const s = v.trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

/** `null` / `~` / `none` / "" are all the document saying "absent". Null, never the literal string. */
function scalar(raw: string | undefined): string | null {
  const v = unquote(raw ?? "").trim();
  if (!v || /^(null|~|none)$/i.test(v)) return null;
  return v.slice(0, MAX_SCALAR);
}

/** `[a, b]` | `a, b` | an accumulated block list -> a bounded string[]. */
function list(raw: string | undefined): string[] {
  let s = (raw ?? "").trim();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  return s
    .split(",")
    .map((t) => unquote(t))
    .filter((t) => t && !/^(null|~|none)$/i.test(t))
    .map((t) => t.slice(0, MAX_SCALAR))
    .slice(0, MAX_REFS);
}

/**
 * The open `kind` vocabulary -> the curated OrgMemory enum (`memory-kinds.ts`).
 *
 * The mapping is a JUDGMENT the format's own README licenses ("readers ignore values they don't
 * recognize"): a decision or a reference is a durable fact (semantic); a failed approach, a convention
 * and a gotcha are all "what to do / not do next time" (procedural); a progress note is what happened
 * on a date (episodic). An unrecognized value falls to `semantic`, matching `normalizeMemoryKind`'s
 * default rather than inventing a second default beside it — and `rawKind` keeps the original either
 * way, so nothing this function decides is lossy.
 */
export function mapMemoryKind(rawKind: string | null): MemoryKind {
  const k = (rawKind ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (k === "decision" || k === "reference") return "semantic";
  if (k === "failed-approach" || k === "convention" || k === "gotcha") return "procedural";
  if (k === "progress") return "episodic";
  return normalizeMemoryKind(k);
}

/** The idempotency key: identical (path, body) always hashes the same; one byte apart never does. */
export function memoryContentHash(path: string, body: string): string {
  return createHash("sha256").update(`${path}\0${body}`).digest("hex").slice(0, 32);
}

/**
 * Parse ONE entry. Returns null when the document has no frontmatter block, never closes it, or has a
 * whitespace-only body — the three "we cannot honestly read this" cases. Never throws.
 */
export function parseRepoMemoryEntry(path: string, content: string): RepoMemoryEntry | null {
  const text = (content ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");

  let start = 0;
  while (start < lines.length && (lines[start] ?? "").trim() === "") start++;
  if (start >= lines.length || (lines[start] ?? "").trim() !== "---") return null;

  const raw: Record<string, string> = {};
  let close = -1;
  let listKey: string | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed === "---" || trimmed === "...") {
      close = i;
      break;
    }
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("- ") || trimmed === "-") {
      if (listKey) {
        const item = unquote(trimmed.replace(/^-\s*/, ""));
        raw[listKey] = raw[listKey] ? `${raw[listKey]}, ${item}` : item;
      }
      continue;
    }
    const m = KEY_RE.exec(trimmed);
    if (!m) continue; // an unreadable line inside the block is ignored, not fatal — the schema is open
    const key = (m[1] ?? "").toLowerCase();
    const value = unquote(m[2] ?? "");
    // A key with an inline `#` comment is common in the seeded format ("kind: decision  # ..."), and
    // the value is the part before it.
    const cleaned = value.replace(/\s+#\s.*$/, "");
    if (cleaned === "") {
      listKey = key;
      raw[key] = "";
    } else {
      listKey = null;
      raw[key] = cleaned;
    }
  }
  if (close === -1) return null; // an unclosed block: the whole document would become "body"

  const rawBody = lines.slice(close + 1).join("\n").trim();
  if (!rawBody) return null;
  const body = rawBody.slice(0, MAX_MEMORY_BODY);

  const rawKind = scalar(raw.kind);
  return {
    path,
    entryId: scalar(raw.id),
    rawKind,
    mappedKind: mapMemoryKind(rawKind),
    scope: scalar(raw.scope),
    entryDate: scalar(raw.date),
    supersedes: scalar(raw.supersedes),
    refs: list(raw.refs),
    body,
    contentHash: memoryContentHash(path, body),
    truncated: rawBody.length > MAX_MEMORY_BODY,
  };
}

/** Parse a batch, keeping the unreadable ones as counted skips rather than dropping them silently. */
export function parseRepoMemoryEntries(files: { path: string; content: string }[]): RepoMemoryParse {
  const entries: RepoMemoryEntry[] = [];
  const skipped: { path: string; reason: MemorySkipReason }[] = [];
  for (const f of files) {
    const entry = parseRepoMemoryEntry(f.path, f.content);
    if (entry) entries.push(entry);
    else skipped.push({ path: f.path, reason: (f.content ?? "").trim() ? "malformed" : "empty" });
  }
  return { entries, skipped };
}

/**
 * The set of entry IDs this batch declares as superseded. Ids, not paths: `supersedes` names a
 * frontmatter `id` (the format's own contract — "add a new file and set `supersedes`"), and an entry
 * that supersedes nothing contributes nothing. The caller resolves ids to mirrored rows, which is why
 * this returns the claims rather than resolving them here (a pure function cannot see the store).
 */
export function supersededIds(entries: RepoMemoryEntry[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) if (e.supersedes) out.add(e.supersedes);
  return out;
}
