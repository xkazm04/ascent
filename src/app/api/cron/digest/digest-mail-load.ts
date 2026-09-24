// The digest's mail part, loaded only for a sink that is mail (backlog develop-2026-09-17 row 16).
//
// A `mailto:` sink gets the weekly digest ARTEFACT (`buildWeeklyDigest`, the same model the Weekly
// digest tab renders) as HTML, attached to the message the alert door carries as `mail`. A Slack
// webhook never pays for the extra reads. The sink is classified RESOLVED (org sink, else the global
// ALERT_WEBHOOK_URL), so a global `mailto:` fallback gets the same mail.
//
// Never throws: a failed artefact read returns undefined and the digest still goes out, rendered from
// its plain text the way every other alert mail is. `buildWeeklyDigest` reads the same trailing week
// the route resolves (`weekRangeParams()` over the canonical zone), so the two cannot disagree on it.

import { sinkKindForOrg, type AlertMailPart, type FleetDigestInput } from "@/lib/alerts";
import { buildDigestMailPart } from "@/lib/email/digest-mail";
import { buildWeeklyDigest } from "@/lib/org/digest";

export async function digestMailPart(
  org: string,
  sink: string | null,
  fleet: FleetDigestInput,
): Promise<AlertMailPart | undefined> {
  if (sinkKindForOrg(sink) !== "email") return undefined;
  const digest = await buildWeeklyDigest(org).catch((err: unknown) => {
    console.warn("[cron/digest] weekly artefact unreadable, mailing the text rendering", {
      org,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });
  return digest ? buildDigestMailPart({ digest, fleet }) : undefined;
}
