import Link from "next/link";
import type { RegistryView } from "@/lib/org/registry-view";
import { ARTIFACTS, ARTIFACT_LABEL } from "../registry/registryModel";
import { RegistryHeaderActions, RegistryMigrateAction } from "../registry/RegistryActions";
import { RegistryConnect } from "./RegistryConnect";
import { RegistryDetails } from "./RegistryDetails";
import { RegistryFlow } from "./RegistryFlow";
import s from "./registry.module.css";

export function RegistryWorkspace({ view, slug }: { view: RegistryView; slug: string }) {
  const mapped = Boolean(view.registry);
  const base = `/org/${encodeURIComponent(slug)}`;
  return <section className={s.workspace} aria-label="Registry v2">
    <header className={s.header}>
      <div><span className={s.eyebrow}>Shared / Registry</span>
        <h1>{mapped ? "Your shared foundation." : "One source. Every repository."}</h1>
        <p>Skills, practices and memory. Versioned together, ready for your team.</p>
      </div>
      <span className={s.badge}>{mapped ? view.registry!.mode === "hosted_mirror" ? "Hosted mirror" : "Git-native" : "Not connected"}</span>
    </header>

    <RegistryFlow view={view} />

    {!mapped ? <RegistryConnect view={view} slug={slug} /> : <section className={s.action} aria-label="Registry actions">
      <div><span className={s.eyebrow}>Next step</span>
        <h2>{view.status === "error" ? "Restore the index" : view.status === "scaffold_pr_open" ? "Review your registry layout" : view.status === "scaffolding" ? "Preparing your registry" : "Keep your team up to date"}</h2>
        <p>{view.status === "error" ? view.error?.message ?? "The last index attempt failed." : view.status === "scaffold_pr_open" ? "Merge the scaffold PR, then re-index to bring its contents into Ascent." : view.status === "scaffolding" ? "The scaffold is being prepared. Refresh to check its progress." : "Re-index after a merge, or sync the latest skills into a repository."}</p>
        {view.scaffoldPrUrl && <a className={s.link} href={view.scaffoldPrUrl} target="_blank" rel="noreferrer">Review scaffold PR ↗</a>}
      </div>
      <RegistryHeaderActions view={view} slug={slug} />
    </section>}

    <div className={s.sectionTitle}><h2>Your library</h2><span className={s.meta}>{mapped ? "Registry + hosted inventory" : "Already in Ascent"}</span></div>
    <div className={s.inventory}>
      {ARTIFACTS.map((artifact, i) => <article className={s.card} key={artifact}>
        <div className={s.cardTop}><span className={s.glyph} aria-hidden="true">{["⌘", "≡", "◇"][i]}</span><span className={s.meta}>{artifact}/</span></div>
        <h3><Link href={`${base}?tab=${artifact}`}>{ARTIFACT_LABEL[artifact]} <span aria-hidden="true">↗</span></Link></h3>
        <div className={s.counts}><div><strong>{view.counts[artifact].registry}</strong><span>in registry</span></div><div><strong>{view.counts[artifact].hostedOnly}</strong><span>hosted only</span></div></div>
        <footer><RegistryMigrateAction view={view} slug={slug} artifact={artifact} step={view.migration[artifact]} /></footer>
      </article>)}
    </div>
    <Link className={s.reference} href={`${base}?tab=knowledge`}><span><span className={s.eyebrow}>Reference knowledge</span><strong>Explore your knowledge base</strong></span><span>{view.bundles.length} bundles <span aria-hidden="true">↗</span></span></Link>
    <RegistryDetails view={view} />
  </section>;
}
