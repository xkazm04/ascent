// PURE composition of the ledger-integrity line (MC-B14). No React, no I/O.
//
// The whole of this feature's UI used to be a non-interactive `<code>` string naming a URL, and it
// lived inside the card's NON-EMPTY branch — so an org with no observations yet was never told the
// ledger is verifiable at all, and an org with observations was told to go and curl something.
//
// VOCABULARY (MC-B10). On the Governance tab the word SEALED already belongs to the AI-stance
// perimeter's no-AI zones. The ledger's tamper-evidence therefore says CHAINED on screen — "chain
// verified through …", "days not yet chained" — and never SEALED. The wire contract keeps its own
// names (`unsealedDays`, `sealBacklogRemaining`): an API field is read by an examiner's script, a
// heading is read by a human on a tab where the other word is taken.

import type { SealChain } from "@/lib/db/control-observations";

export interface LedgerIntegrityView {
  /** The headline sentence. Always renderable — an empty ledger gets its own honest phrasing rather
   *  than a blank or a green tick over nothing. */
  headline: string;
  tone: "good" | "bad" | "unknown";
  /** The second line: what the reader should do or know. Null when there is nothing to add. */
  detail: string | null;
}

/**
 * Compose the line from a verified chain. `null` (no database, or the read failed) is its own arm:
 * silence about integrity is honest, a green "verified" over an unread chain is not.
 */
export function ledgerIntegrityLine(chain: SealChain | null): LedgerIntegrityView {
  if (!chain) {
    return {
      headline: "Ledger integrity: not readable.",
      tone: "unknown",
      detail: "The seal chain could not be read, so nothing is claimed about it either way.",
    };
  }

  const broken = chain.checks.filter((c) => c.verdict === "tampered" || c.verdict === "broken-chain");
  const purged = chain.checks.filter((c) => c.verdict === "no-rows");
  // "Not yet chained" counts CLOSED days only in spirit, but today is always in `unsealedDays` by
  // construction, so the count is stated as-is and the sentence names today explicitly below.
  const pending = chain.unsealedDays.length;
  const pendingPhrase = `${pending} day${pending === 1 ? "" : "s"} not yet chained`;

  if (broken.length > 0) {
    return {
      headline: `Ledger integrity: CHAIN BROKEN at ${broken.map((c) => c.day).join(", ")} · ${pendingPhrase}`,
      tone: "bad",
      detail:
        "A chained day no longer recomputes to its stored root, or its link to the preceding day does not match. " +
        "Rows in that window were altered or removed after they were chained. Export the rows and verify them yourself.",
    };
  }

  const verified = chain.checks.length > 0 ? chain.checks[chain.checks.length - 1]!.day : null;
  if (!verified) {
    return {
      headline: `Ledger integrity: no day chained yet · ${pendingPhrase}`,
      tone: "unknown",
      detail:
        "A day is chained after it closes, on the daily schedule. Until the first one is, alteration of these rows " +
        "is not detectable — this states that rather than showing a verified badge over nothing.",
    };
  }

  const notes: string[] = [];
  if (purged.length > 0) {
    notes.push(
      `${purged.length} chained day${purged.length === 1 ? " has" : "s have"} had their rows aged out under the retention ` +
        "policy. The chain entry is kept on purpose, so the deleted window stays visible as a gap.",
    );
  }
  if (chain.sealBacklogRemaining > 0) {
    notes.push(
      `${chain.sealBacklogRemaining} closed day${chain.sealBacklogRemaining === 1 ? "" : "s"} will still be waiting after the ` +
        "next scheduled pass. A day whose rows are purged before it is chained leaves nothing behind to prove they existed.",
    );
  }

  return {
    headline: `Ledger integrity: chain verified through ${verified} · ${pendingPhrase}`,
    tone: chain.chainOk ? "good" : "unknown",
    detail: notes.length > 0 ? notes.join(" ") : "Today is always among them: a day is chained only after it closes.",
  };
}
