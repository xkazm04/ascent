import type { RegistryView } from "@/lib/org/registry-view";
import { registrySteps } from "../registry/registryModel";
import { RegistryCommands } from "./RegistryCommands";
import s from "./registry.module.css";

export function RegistryDetails({ view }: { view: RegistryView }) {
  const r = view.registry;
  return <div className={s.details}>
    <RegistryCommands view={view} />
    <details><summary>Setup checklist <span>6 milestones</span></summary>
      <ol className={s.steps}>{registrySteps(view).map(step => <li key={step.id}>
        <span className={s.stepNumber}>{step.n}</span><div><strong>{step.title}</strong><p>{step.id === "point" || step.id === "verify" ? "Fleet sync coverage is not measured yet." : step.detail}</p></div><span className={s.meta}>{step.state}</span>
      </li>)}</ol>
    </details>
    <details><summary>Index & usage <span>Technical health</span></summary>
      <dl className={s.readings}>
        <div><dt>Last index</dt><dd>{r?.lastIndexedAt ? new Date(r.lastIndexedAt).toISOString() : "Not indexed"}</dd></div>
        <div><dt>Commit</dt><dd>{r?.lastIndexSha ?? "Not recorded"}</dd></div>
        <div><dt>Catalog</dt><dd>{r?.catalogSha ?? "Not written"}</dd></div>
        <div><dt>Webhook</dt><dd>{!r ? "Not connected" : r.webhookHealthy ? "Healthy" : "No healthy signal"}</dd></div>
        <div><dt>Contents permission</dt><dd>{view.permission.contentsWrite ? "Write granted" : "Write not granted"}{!view.permission.contentsWrite && view.permission.installUrl && <> · <a href={view.permission.installUrl}>Update permissions ↗</a></>}</dd></div>
        <div><dt>Telemetry sink</dt><dd>{view.telemetry.sink}</dd></div>
        <div><dt>Registry invokes · 30d</dt><dd>{r?.lastIndexedAt ? view.telemetry.invokes30d.toLocaleString() : "Not measured"}</dd></div>
        <div><dt>Direct API invokes · 30d</dt><dd>{view.telemetry.invokesDirect30d == null ? "Not measured" : view.telemetry.invokesDirect30d.toLocaleString()}</dd></div>
        <div><dt>Registry contributors</dt><dd>{r?.lastIndexedAt ? view.telemetry.reposReporting : "Not measured"}</dd></div>
        <div><dt>Lessons</dt><dd>{view.counts.lessons}</dd></div>
      </dl><p className={s.hint}>The two usage sources are reported separately; they may overlap.</p>
    </details>
    <details><summary>Recent activity <span>{view.activity.length} events</span></summary>
      {view.activity.length ? <ul className={s.activity}>{view.activity.map((event, i) => <li key={`${event.at}-${i}`}><span className={s.meta}>{event.kind}</span><div>{event.url ? <a href={event.url} target="_blank" rel="noreferrer">{event.title} ↗</a> : event.title}</div><time dateTime={event.at}>{event.at.slice(0, 10)}</time></li>)}</ul> : <p>No registry activity yet.</p>}
    </details>
  </div>;
}
