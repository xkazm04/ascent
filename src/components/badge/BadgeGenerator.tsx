"use client";

// One-click badge embed generator (Codecov/shields.io growth-loop pattern). Wraps the
// existing /api/badge/[owner]/[repo] SVG: pick a repo + style, see a live preview, and copy
// the embed snippet in Markdown / HTML / AsciiDoc — each links the badge back to the report.

import { useMemo, useState } from "react";
import Link from "next/link";

/** Minimal owner/repo parser (kept local so this client component doesn't pull the
 *  server-side ingestion module). Accepts `owner/repo` or a github.com URL. */
function parseRepo(input: string): { owner: string; repo: string } | null {
  let s = input.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/i, "");
  s = s.replace(/^@/, "");
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo] = parts;
  const ok = /^[A-Za-z0-9_.-]+$/;
  if (!ok.test(owner) || !ok.test(repo)) return null;
  return { owner, repo };
}

type Style = "flat" | "flat-square" | "for-the-badge";
type Kind = "level" | "gate";
type Format = "markdown" | "html" | "asciidoc";

const STYLES: Style[] = ["flat", "flat-square", "for-the-badge"];
const FORMATS: { id: Format; label: string }[] = [
  { id: "markdown", label: "Markdown" },
  { id: "html", label: "HTML" },
  { id: "asciidoc", label: "AsciiDoc" },
];

export function BadgeGenerator() {
  const [input, setInput] = useState("");
  const [style, setStyle] = useState<Style>("flat");
  const [kind, setKind] = useState<Kind>("level");
  const [format, setFormat] = useState<Format>("markdown");
  const [copied, setCopied] = useState(false);

  const parsed = useMemo(() => parseRepo(input), [input]);
  // Origin is only known client-side; absolute URLs make the snippet portable into any README.
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const badgeUrl = useMemo(() => {
    if (!parsed) return "";
    const qs = new URLSearchParams();
    if (style !== "flat") qs.set("style", style);
    if (kind === "gate") qs.set("gate", "1");
    const q = qs.toString();
    return `${origin}/api/badge/${parsed.owner}/${parsed.repo}${q ? `?${q}` : ""}`;
  }, [parsed, style, kind, origin]);

  const reportUrl = parsed ? `${origin}/report/${parsed.owner}/${parsed.repo}` : "";
  const alt = kind === "gate" ? "Ascent maturity gate" : "Ascent maturity";

  const snippet = useMemo(() => {
    if (!parsed || !badgeUrl) return "";
    switch (format) {
      case "markdown":
        return `[![${alt}](${badgeUrl})](${reportUrl})`;
      case "html":
        return `<a href="${reportUrl}"><img src="${badgeUrl}" alt="${alt}" /></a>`;
      case "asciidoc":
        return `${reportUrl}[image:${badgeUrl}[${alt}]]`;
    }
  }, [parsed, badgeUrl, reportUrl, alt, format]);

  function copy() {
    if (!snippet) return;
    navigator.clipboard?.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-widest transition ${
      active ? "border-accent bg-accent/10 text-accent" : "border-slate-700 text-slate-400 hover:border-slate-600"
    }`;

  return (
    <div className="space-y-5">
      {/* Repo input */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <label htmlFor="badge-repo" className="font-mono text-[11px] uppercase tracking-widest text-slate-500">
          Repository
        </label>
        <input
          id="badge-repo"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="owner/repo or https://github.com/owner/repo"
          className="focus-ring mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-accent"
        />
        {input && !parsed && (
          <p className="mt-2 text-xs text-danger-soft">Enter a valid repository, e.g. facebook/react.</p>
        )}

        {/* Options */}
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Badge</span>
            <button type="button" onClick={() => setKind("level")} className={chip(kind === "level")}>
              level
            </button>
            <button type="button" onClick={() => setKind("gate")} className={chip(kind === "gate")}>
              gate
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Style</span>
            {STYLES.map((s) => (
              <button key={s} type="button" onClick={() => setStyle(s)} className={chip(style === s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Live preview */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500">Preview</div>
        <div className="mt-3 flex min-h-[44px] items-center">
          {parsed && badgeUrl ? (
            <a href={reportUrl} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={badgeUrl} alt={alt} className="h-7" />
            </a>
          ) : (
            <span className="text-sm text-slate-500">Enter a repository to preview its badge.</span>
          )}
        </div>
      </div>

      {/* Snippet + copy */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {FORMATS.map((f) => (
              <button key={f.id} type="button" onClick={() => setFormat(f.id)} className={chip(format === f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={copy}
            disabled={!snippet}
            className="focus-ring rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition hover:bg-accent-soft disabled:opacity-50"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-slate-300">
          {snippet || "— enter a repository above —"}
        </pre>
      </div>

      <p className="text-xs text-slate-500">
        Tip: the badge runs a fast deterministic scan on first request, then caches. For a full
        AI-scored report, <Link href="/" className="text-accent hover:text-accent-soft">scan the repo</Link> first.
      </p>
    </div>
  );
}
