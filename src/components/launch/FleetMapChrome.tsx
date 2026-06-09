import Link from "next/link";

export function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-slate-400">
      <span className="font-mono text-base font-bold tabular-nums" style={color ? { color } : { color: "#fff" }}>
        {value}
      </span>{" "}
      <span className="font-mono uppercase tracking-widest text-sm">{label}</span>
    </span>
  );
}

export function EmptyFleet() {
  return (
    <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center">
      <div className="text-4xl">🛰️</div>
      <h2 className="mt-3 text-lg font-semibold text-white">No constellations yet</h2>
      <p className="mx-auto mt-1 max-w-md text-base text-slate-400">
        Install the Ascent GitHub App on an organization or account and your repositories will appear here as a
        star-map of maturity.
      </p>
      <Link
        href="/connect"
        className="focus-ring mt-4 inline-block rounded-lg bg-accent px-5 py-2.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
      >
        Connect GitHub →
      </Link>
    </div>
  );
}
