// PAIRING HEALTH, as the loop reports it — one pure module for the three places that must agree.
//
//   • `proposalPairing` — the verdict the curation route (GET /api/org/loop/propose) attaches to each
//     paired repo's proposal. Only `ok` and the verifier's sentence cross the wire: that route is
//     member-readable, and the stored path, origin and HEAD are not a member's to read.
//   • `pairingRefusal` — the ONE refusal `startLoopRun` throws when any pairing in the set is broken,
//     naming every broken repo with its reason (it used to throw at the first, so N broken repos cost
//     N presses of Run).
//   • `reposNamedIn` — how the standing runner reads that refusal back into repo names to pause.
//
// The producer and the parser live side by side because the refusal text is a CONTRACT between the
// engine and the runner (runner.ts pauses whatever repos a refusal names). A change to one without the
// other is exactly the drift `loop-engine.pairing.test.ts` pins against.
//
// Pure: no filesystem, no git. The verification itself stays in `pairing.ts` (`verifyLocalPath`), which
// both the route and the engine call, so the preview and the dispatch cannot disagree.

/** A proposal's pairing verdict. Absent/null = the repo has no stored path (nothing to verify). */
export type ProposalPairing = { ok: true } | { ok: false; error: string };

/** Reduce a full `PairingCheck` to what the curation route may disclose. */
export function proposalPairing(check: { ok: boolean; error: string | null }): ProposalPairing {
  return check.ok ? { ok: true } : { ok: false, error: check.error ?? "The pairing no longer verifies." };
}

/** One repo `startLoopRun` cannot arm. `reason` null = no stored path at all (never paired). */
export interface BrokenPairing {
  repo: string;
  reason: string | null;
}

const sentence = (s: string): string => (/[.!?)]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/**
 * The refusal for a set of broken pairings, or null when there are none.
 *
 * One broken repo keeps the exact wording the engine has always thrown, so a caller matching on it is
 * unaffected. Several are listed in one message, each repo with its own reason.
 */
export function pairingRefusal(broken: readonly BrokenPairing[]): string | null {
  if (broken.length === 0) return null;
  if (broken.length === 1) {
    const [b] = broken;
    return b!.reason == null
      ? `${b!.repo} is not paired with a local path. Pair it on Admin → Pairing.`
      : `Pairing broken for ${b!.repo}: ${b!.reason}`;
  }
  const lines = broken.map((b) => (b.reason == null ? `${b.repo} is not paired with a local path.` : `${b.repo}: ${sentence(b.reason)}`));
  return `Pairing broken for ${broken.length} repositories. ${lines.join(" ")} Re-pair them on Admin → Pairing, then run again.`;
}

/**
 * Which of `repos` a refusal names, in `repos` order.
 *
 * Longest name first, and each match is CONSUMED before the shorter names are tried: `o/ab` must not
 * also count as a mention of `o/a`. This generalises the runner's old "longest named repo wins" rule
 * from one repo to every repo a multi-repo refusal lists.
 */
export function reposNamedIn(message: string, repos: readonly string[]): string[] {
  let rest = message;
  const named = new Set<string>();
  for (const repo of [...repos].sort((a, b) => b.length - a.length)) {
    if (!repo || !rest.includes(repo)) continue;
    named.add(repo);
    rest = rest.split(repo).join("\u0000");
  }
  return repos.filter((r) => named.has(r));
}
