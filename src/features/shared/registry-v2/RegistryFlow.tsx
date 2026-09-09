import type { RegistryView } from "@/lib/org/registry-view";
import s from "./registry.module.css";

export function RegistryFlow({ view }: { view: RegistryView }) {
  const r = view.registry;
  return <section className={s.flow} aria-label={r ? "Registry distribution" : "How a registry connects"}>
    <div className={s.flowLabel}>{r ? "Distribution" : "Connection preview"}<span>Source → Index → Fleet</span></div>
    <div className={s.stages}>
      <article className={s.stage}><span className={s.node} aria-hidden="true">⑂</span><span className={s.eyebrow}>01 / Source</span><h2>{r?.fullName ?? "Your registry repo"}</h2><p>{r ? r.defaultBranch : "Your rules, reviewed in Git"}</p><span className={s.tag}>{r ? "Connected" : "Choose a repository"}</span></article>
      <span className={s.connector} aria-hidden="true">→</span>
      <article className={s.stage}><span className={s.node} aria-hidden="true">▦</span><span className={s.eyebrow}>02 / Index</span><h2>Ascent catalog</h2><p>Skills · Practices · Memory</p><span className={s.tag}>{view.status === "error" ? "Index needs attention" : r?.lastIndexedAt ? `Indexed · ${r.lastIndexSha?.slice(0, 7) ?? "HEAD"}` : "Awaiting first index"}</span></article>
      <span className={s.connector} aria-hidden="true">→</span>
      <article className={s.stage}><span className={s.node} aria-hidden="true">▱</span><span className={s.eyebrow}>03 / Fleet</span><h2>{view.fleet.reposTotal} repositories</h2><p>Pull shared skills into each repo</p><span className={s.tag}>Sync coverage not measured</span></article>
    </div>
  </section>;
}
