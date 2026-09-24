// The deploy marker's colour, shared by the server-rendered legend (TimelineAnnotations) and the
// client chart (TrendChart). Kept in its own import-free module so the client bundle takes two
// strings, not `annotations.ts` and the alerting module it reads its threshold from.
//
// Two tones only, because the marker makes one claim: the DEPLOYMENT's own status. A failure is red;
// anything else (success, pending, in progress, inactive) is the neutral deploy blue. It is never
// styled as an incident, which the Deployments API cannot observe.

/** A deploy marker whose scan window holds no failed deployment. */
export const DEPLOY_OK_COLOR = "#60a5fa";
/** A deploy marker whose scan window holds at least one `failure` / `error` deployment. */
export const DEPLOY_FAILED_COLOR = "#f87171";

/** The tone for a marker, from its folded deploy counts. */
export function deployColor(deploys: { failed: number } | undefined): string {
  return deploys && deploys.failed > 0 ? DEPLOY_FAILED_COLOR : DEPLOY_OK_COLOR;
}
