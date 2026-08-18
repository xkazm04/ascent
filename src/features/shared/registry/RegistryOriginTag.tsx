// The per-row "where does this row live?" marker, shared by Skills, Memory and Practices.
//
// A row mirrored out of the registry repo (`origin === "registry"`) is PR-only: ascent indexed it and
// must not offer to edit or archive it, because the next index pass would simply overwrite whatever
// the user typed. A hosted row is ascent's own and keeps every in-app affordance. The two are
// indistinguishable in a table unless something says so, so every row says so.
//
// Its own file (not RegistrySyncStrip.tsx) because the consumers are CLIENT components: importing the
// tag should not drag the strip, `next/link` and the sync loader's types into their bundle.
//
// Pure and import-free: safe on the server and in a browser bundle.

/** Blob URL of a mirrored file. Null unless BOTH a registry base and an indexed path exist, so an
 *  "Open in registry" link can never be rendered pointing at a path that was never indexed. */
export function registryBlobHref(base: string | null | undefined, path: string | null | undefined): string | null {
  if (!base || !path) return null;
  return `${base}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function OriginTag({ origin, path }: { origin: string; path?: string | null }) {
  const isRegistry = origin === "registry";
  return (
    <span
      className={`rounded border px-1.5 py-0.5 font-mono text-xs ${isRegistry ? "border-accent/40 text-accent" : "border-slate-700 text-slate-500"}`}
      title={
        isRegistry
          ? `Mirrored from ${path ?? "the registry"} — change it with a pull request, not in ascent.`
          : "Authored in ascent, in ascent's own tables. It is not in a registry repo."
      }
    >
      {isRegistry ? "registry" : "hosted"}
    </span>
  );
}

/** The link that REPLACES an in-app edit/archive affordance on a registry-origin row. */
export function OpenInRegistry({ href, label = "Open in registry ↗" }: { href: string | null; label?: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="focus-ring font-mono text-xs text-accent transition hover:text-white">
      {label}
    </a>
  );
}
