"use client";

// Org settings → per-org retention + compaction (the four Organization columns). Owner-only by
// absence: SettingsTab gates the tab before this card is built. Saving writes columns only; the
// nightly purge applies them. Preview is a dry-run of the proposed policy and is required before save.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import {
  parseOrgRetentionBody,
  type OrgRetentionColumns,
  type OrgRetentionView,
} from "@/lib/db/retention-policy";

const INPUT =
  "mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 type-mono-sm text-slate-200 placeholder:text-slate-600 disabled:opacity-50";

type PreviewCounts = {
  scansDeleted: number;
  dimensionsDeleted: number;
  recommendationsDeleted: number;
  auditDeleted: number;
  digestsWouldWrite: number | null;
};

function intStr(n: number | null): string {
  return n == null ? "" : String(n);
}

function compactStr(v: boolean | null): string {
  return v == null ? "" : v ? "true" : "false";
}

function keyOf(c: OrgRetentionColumns): string {
  return JSON.stringify(c);
}

function draftFromForm(form: { maxScans: string; auditDays: string; compact: string; digestMonths: string }) {
  return parseOrgRetentionBody({
    retentionMaxScans: form.maxScans === "" ? null : form.maxScans,
    retentionAuditDays: form.auditDays === "" ? null : form.auditDays,
    retentionCompact: form.compact === "" ? null : form.compact === "true",
    retentionDigestMonths: form.digestMonths === "" ? null : form.digestMonths,
  });
}

export function RetentionCard({ slug, initial }: { slug: string; initial: OrgRetentionView | null }) {
  const router = useRouter();
  const stored = initial?.stored;
  const [maxScans, setMaxScans] = useState(intStr(stored?.retentionMaxScans ?? null));
  const [auditDays, setAuditDays] = useState(intStr(stored?.retentionAuditDays ?? null));
  const [compact, setCompact] = useState(compactStr(stored?.retentionCompact ?? null));
  const [digestMonths, setDigestMonths] = useState(intStr(stored?.retentionDigestMonths ?? null));
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [preview, setPreview] = useState<PreviewCounts | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const parsed = useMemo(
    () => draftFromForm({ maxScans, auditDays, compact, digestMonths }),
    [maxScans, auditDays, compact, digestMonths],
  );
  const draftKey = parsed.ok ? keyOf(parsed.stored) : null;
  const canPreview = Boolean(initial) && parsed.ok && busy === null;
  const canSave = canPreview && previewKey === draftKey && preview !== null;

  async function post(previewFlag: boolean) {
    if (!parsed.ok || busy) return;
    setBusy(previewFlag ? "preview" : "save");
    setMsg(null);
    try {
      const res = await fetch("/api/org/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, ...parsed.stored, ...(previewFlag ? { preview: true } : {}) }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; preview?: PreviewCounts; purged?: boolean }
        | null;
      if (!res.ok || !data) {
        setMsg({ kind: "err", text: data?.error ?? `Request failed (${res.status}).` });
        return;
      }
      if (previewFlag) {
        setPreview(data.preview ?? { scansDeleted: 0, dimensionsDeleted: 0, recommendationsDeleted: 0, auditDeleted: 0, digestsWouldWrite: null });
        setPreviewKey(draftKey);
        return;
      }
      setMsg({ kind: "ok", text: "Saved. The next nightly purge will apply this policy. Nothing was deleted." });
      router.refresh();
    } catch {
      setMsg({ kind: "err", text: "Network error. Nothing was changed." });
    } finally {
      setBusy(null);
    }
  }

  const floors = initial?.floors;
  const inheritScans = initial?.defaults.maxScansPerRepo ?? 0;
  const inheritAudit = initial?.defaults.auditDays ?? 0;
  const inheritCompact = initial?.compactDefault ? "on" : "off";
  const inheritDigest = initial?.digestMonthsDefault ?? 0;

  return (
    <Card id="retention">
      <SectionHeader
        size="sm"
        title="Data retention"
        description="Owner only · applies on the next nightly purge"
      />
      <p className="mt-3 max-w-2xl type-body-sm text-slate-400">
        Keep the newest N scans per repo and audit entries younger than X days. Compaction folds pruned
        scans into monthly digests. Blank inherits the deployment default; 0 keeps everything. Saving
        updates the policy; it never deletes data.
      </p>
      {!initial ? (
        <p className="mt-4 type-body-sm text-orange-200">Retention is unavailable without a database.</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="type-mono-sm text-slate-500">Max scans per repo (floor {floors?.maxScansPerRepo})</span>
            <input className={INPUT} inputMode="numeric" aria-label="Max scans per repo" placeholder={`inherit (${inheritScans})`} value={maxScans} onChange={(e) => { setMaxScans(e.target.value); setPreview(null); setPreviewKey(null); }} />
          </label>
          <label className="block">
            <span className="type-mono-sm text-slate-500">Audit log days (floor {floors?.auditDays})</span>
            <input className={INPUT} inputMode="numeric" aria-label="Audit log days" placeholder={`inherit (${inheritAudit})`} value={auditDays} onChange={(e) => { setAuditDays(e.target.value); setPreview(null); setPreviewKey(null); }} />
          </label>
          <label className="block">
            <span className="type-mono-sm text-slate-500">Compact pruned scans</span>
            <select className={INPUT} aria-label="Compact pruned scans" value={compact} onChange={(e) => { setCompact(e.target.value); setPreview(null); setPreviewKey(null); }}>
              <option value="">Inherit ({inheritCompact})</option>
              <option value="true">On</option>
              <option value="false">Off</option>
            </select>
          </label>
          <label className="block">
            <span className="type-mono-sm text-slate-500">Digest age (months)</span>
            <input className={INPUT} inputMode="numeric" aria-label="Digest age in months" placeholder={`inherit (${inheritDigest})`} value={digestMonths} onChange={(e) => { setDigestMonths(e.target.value); setPreview(null); setPreviewKey(null); }} />
          </label>
        </div>
      )}
      {parsed.ok === false && initial && (
        <p role="alert" className="mt-3 type-body-sm text-orange-300">{parsed.error}</p>
      )}
      {preview && (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 type-body-sm text-slate-300 sm:grid-cols-4">
          <dt className="text-slate-500">Scans</dt><dd>{preview.scansDeleted}</dd>
          <dt className="text-slate-500">Dimensions</dt><dd>{preview.dimensionsDeleted}</dd>
          <dt className="text-slate-500">Recommendations</dt><dd>{preview.recommendationsDeleted}</dd>
          <dt className="text-slate-500">Audit</dt><dd>{preview.auditDeleted}</dd>
          <dt className="text-slate-500">Digests (would write)</dt>
          <dd>{preview.digestsWouldWrite == null ? "unknown" : preview.digestsWouldWrite}</dd>
        </dl>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" data-testid="retention-preview" onClick={() => void post(true)} disabled={!canPreview} className="rounded-lg border border-slate-700 px-3 py-1.5 type-body-sm text-slate-300 hover:border-accent hover:text-white disabled:opacity-50">
          {busy === "preview" ? "Previewing…" : "Preview what the next purge would delete"}
        </button>
        <button type="button" data-testid="retention-save" onClick={() => void post(false)} disabled={!canSave} className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 type-body-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50">
          {busy === "save" ? "Saving…" : "Save policy"}
        </button>
      </div>
      {msg && (
        <p role="status" className={`mt-3 type-body-sm ${msg.kind === "ok" ? "text-emerald-300" : "text-orange-300"}`}>{msg.text}</p>
      )}
    </Card>
  );
}
