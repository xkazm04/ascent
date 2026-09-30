export function SkillsLibraryEmptyV2({ loading, filtered }: { loading: boolean; filtered: boolean }) {
  if (loading) return <p className="mt-4 type-body text-slate-400">Loading…</p>;
  if (filtered) return <p className="mt-4 type-body text-slate-400">No skills match your filters.</p>;
  return (
    <div className="mt-4 type-body text-slate-400">
      <p>No skills yet.</p>
      <p className="mt-1">
        Skills are not written here. Link the org&apos;s registry and every skill in its{" "}
        <span className="font-mono text-slate-400">skills/</span> lane appears on the next sync; each project then
        reports its own use counts into the registry&apos;s <span className="font-mono text-slate-400">usage/</span>{" "}
        lane, and this list sums them.
      </p>
    </div>
  );
}
